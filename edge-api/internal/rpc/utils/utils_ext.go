//go:build !plus

package rpcutils

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	teaconst "github.com/TeaOSLab/EdgeAPI/internal/const"
	"github.com/TeaOSLab/EdgeAPI/internal/db/models"
	"github.com/TeaOSLab/EdgeAPI/internal/encrypt"
	"github.com/TeaOSLab/EdgeAPI/internal/errors"
	"github.com/TeaOSLab/EdgeAPI/internal/utils"
	"github.com/iwind/TeaGo/lists"
	"github.com/iwind/TeaGo/maps"
	"google.golang.org/grpc/metadata"
)

// MaxTokenClockSkewSeconds is the maximum allowed distance (in either
// direction) between a token's 'timestamp' field and the server's current
// time (FIX-04). Tokens are generated fresh for every single RPC call by
// all first-party clients (EdgeNode, EdgeAdmin, EdgeAPI-to-EdgeAPI), so this
// is a replay/staleness window, not a session lifetime.
const MaxTokenClockSkewSeconds = int64(300)

// ValidateRequest 校验请求
func ValidateRequest(ctx context.Context, userTypes ...UserType) (userType UserType, resultNodeId int64, userId int64, err error) {
	if ctx == nil {
		err = errors.New("context should not be nil")
		return
	}

	// 支持直接认证
	plainCtx, ok := ctx.(*PlainContext)
	if ok {
		userType = plainCtx.UserType
		userId = plainCtx.UserId

		if len(userTypes) > 0 && !lists.ContainsString(userTypes, userType) {
			userType = UserTypeNone
			userId = 0
		}

		if userId <= 0 {
			err = errors.New("context: can not find user or permission denied")
		}

		return
	}

	// 是否是模拟测试
	{
		mockCtx, isMock := ctx.(*MockNodeContext)
		if isMock {
			return UserTypeNode, 0, mockCtx.NodeId, nil
		}
	}

	{
		mockCtx, isMock := ctx.(*MockAdminNodeContext)
		if isMock {
			return UserTypeAdmin, 0, mockCtx.AdminId, nil
		}
	}

	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return UserTypeNone, 0, 0, errors.New("context: need 'nodeId'")
	}
	nodeIds := md.Get("nodeid")
	if len(nodeIds) == 0 || len(nodeIds[0]) == 0 {
		return UserTypeNone, 0, 0, errors.New("context: need 'nodeId'")
	}
	nodeId := nodeIds[0]

	// 获取角色Node信息
	apiToken, err := models.SharedApiTokenDAO.FindEnabledTokenWithNodeCacheable(nil, nodeId)
	if err != nil {
		utils.PrintError(err)
		return UserTypeNone, 0, 0, err
	}
	nodeUserId := int64(0)
	if apiToken == nil {
		return UserTypeNode, 0, 0, errors.New("context: can not find api token for node '" + nodeId + "'")
	}

	tokens := md.Get("token")
	if len(tokens) == 0 || len(tokens[0]) == 0 {
		return UserTypeNone, 0, 0, errors.New("context: need 'token'")
	}
	token := tokens[0]

	data, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return UserTypeNone, 0, 0, err
	}

	method, err := encrypt.NewMethodInstance(teaconst.EncryptMethod, apiToken.Secret, nodeId)
	if err != nil {
		utils.PrintError(err)
		return UserTypeNone, 0, 0, err
	}
	data, err = method.Decrypt(data)
	if err != nil {
		return UserTypeNone, 0, 0, err
	}
	if len(data) == 0 {
		return UserTypeNone, 0, 0, errors.New("invalid token")
	}

	var m = maps.Map{}
	err = json.Unmarshal(data, &m)
	if err != nil {
		return UserTypeNone, 0, 0, errors.New("decode token error: " + err.Error())
	}

	// FIX-04: reject stale or replayed tokens. All first-party clients put a
	// fresh unix-second 'timestamp' in the token on every call, so a missing
	// or out-of-window value means either a forged/replayed token or a badly
	// skewed clock; either way we must not trust it.
	if !IsFreshTimestamp(m.GetInt64("timestamp"), time.Now().Unix(), MaxTokenClockSkewSeconds) {
		return UserTypeNone, 0, 0, errors.New("context: token timestamp is missing or outside of the allowed window")
	}

	t := m.GetString("type")

	// FIX-01: the 'type' field above is whatever the holder of the secret put
	// into their own encrypted token, so it must never be trusted on its own.
	// The database role recorded for this token's secret (apiToken.Role) is
	// the only authoritative source of identity; a caller may only claim a
	// type that matches its role, with exactly one legacy exception.
	if !allowedClaim(apiToken.Role, t) {
		return UserTypeNone, 0, 0, errors.New("context: role '" + apiToken.Role + "' is not allowed to claim type '" + t + "'")
	}

	if len(userTypes) > 0 && !lists.ContainsString(userTypes, t) {
		return UserTypeNone, 0, 0, errors.New("not supported node type: '" + t + "'")
	}

	switch apiToken.Role {
	case UserTypeNode:
		nodeIntId, err := models.SharedNodeDAO.FindEnabledNodeIdWithUniqueId(nil, nodeId)
		if err != nil {
			return UserTypeNode, 0, 0, errors.New("context: " + err.Error())
		}
		if nodeIntId <= 0 {
			return UserTypeNode, 0, 0, errors.New("context: not found node with id '" + nodeId + "'")
		}
		nodeUserId = nodeIntId
		resultNodeId = nodeIntId
	case UserTypeCluster:
		clusterId, err := models.SharedNodeClusterDAO.FindEnabledClusterIdWithUniqueId(nil, nodeId)
		if err != nil {
			return UserTypeCluster, 0, 0, errors.New("context: " + err.Error())
		}
		if clusterId <= 0 {
			return UserTypeCluster, 0, 0, errors.New("context: not found cluster with id '" + nodeId + "'")
		}
		nodeUserId = clusterId
		resultNodeId = clusterId
	case UserTypeUser:
		nodeIntId, err := models.SharedUserNodeDAO.FindEnabledUserNodeIdWithUniqueId(nil, nodeId)
		if err != nil {
			return UserTypeUser, 0, 0, errors.New("context: " + err.Error())
		}
		if nodeIntId <= 0 {
			return UserTypeUser, 0, 0, errors.New("context: not found node with id '" + nodeId + "'")
		}
		resultNodeId = nodeIntId
	}

	if nodeUserId > 0 {
		return t, resultNodeId, nodeUserId, nil
	} else {
		return t, resultNodeId, m.GetInt64("userId"), nil
	}
}

// allowedClaim reports whether a token backed by the database role 'role'
// (edgeAPITokens.role) is allowed to claim to be of type 'claimed' (the
// 'type' field inside the caller's own encrypted token payload).
//
// The rule is that the claim must match the role exactly, with exactly one
// exception: a token whose role is 'admin' may additionally claim 'api'.
// That exception exists because EdgeAdmin's APIContext()
// (edge-admin/internal/rpc/rpc_client.go) signs 'type:"api"' tokens using
// the secret of the 'admin' role token, for the setup wizard and recovery
// mode, and must keep working.
//
// This is a pure function so the whole role x claim matrix can be
// unit-tested directly without needing a database or network context.
func allowedClaim(role string, claimed string) bool {
	if len(role) == 0 || len(claimed) == 0 {
		return false
	}

	if role == claimed {
		return true
	}

	if role == UserTypeAdmin && claimed == UserTypeAPI {
		return true
	}

	return false
}

// IsFreshTimestamp reports whether a client-supplied unix-second timestamp
// is within maxSkewSeconds of the server's current time ('now', also unix
// seconds). A missing or non-positive timestamp is never considered fresh.
//
// This is a pure function (no clock access) so it can be unit-tested with
// fixed 'now'/'timestamp' values.
func IsFreshTimestamp(timestamp int64, now int64, maxSkewSeconds int64) bool {
	if timestamp <= 0 || maxSkewSeconds < 0 {
		return false
	}

	diff := now - timestamp
	if diff < 0 {
		diff = -diff
	}
	return diff <= maxSkewSeconds
}
