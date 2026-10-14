package models

import (
	"errors"
	dbutils "github.com/TeaOSLab/EdgeAPI/internal/db/utils"
	"github.com/TeaOSLab/EdgeAPI/internal/utils/sealed"
	_ "github.com/go-sql-driver/mysql"
	"github.com/iwind/TeaGo/Tea"
	"github.com/iwind/TeaGo/dbs"
	"github.com/iwind/TeaGo/logs"
	"github.com/iwind/TeaGo/types"
)

const (
	NodeGrantStateEnabled  = 1 // 已启用
	NodeGrantStateDisabled = 0 // 已禁用
)

type NodeGrantDAO dbs.DAO

func NewNodeGrantDAO() *NodeGrantDAO {
	return dbs.NewDAO(&NodeGrantDAO{
		DAOObject: dbs.DAOObject{
			DB:     Tea.Env,
			Table:  "edgeNodeGrants",
			Model:  new(NodeGrant),
			PkName: "id",
		},
	}).(*NodeGrantDAO)
}

var SharedNodeGrantDAO *NodeGrantDAO

func init() {
	dbs.OnReady(func() {
		SharedNodeGrantDAO = NewNodeGrantDAO()
	})
}

// sealGrantSecret seals an SSH grant secret (password/private key/
// passphrase) for storage. Empty input is left empty so "not set" stays
// distinguishable from "set to an empty value".
func sealGrantSecret(plain string) (string, error) {
	if len(plain) == 0 {
		return "", nil
	}
	return sealed.Seal([]byte(plain))
}

// openGrantSecret decrypts a sealed SSH grant secret for internal use (SSH
// installer connections, "test connection", or restoring the stored value
// when an update request echoes back a masked/unchanged field). Legacy rows
// written before sealing was introduced are plaintext and pass through
// unchanged. A decryption failure is logged and treated as "no secret
// available" rather than returned as ciphertext.
func openGrantSecret(value string) string {
	if len(value) == 0 {
		return value
	}
	plain, err := sealed.Open(value)
	if err != nil {
		logs.Println("[NODE_GRANT]failed to open sealed secret: " + err.Error())
		return ""
	}
	return string(plain)
}

// EnableNodeGrant 启用条目
func (this *NodeGrantDAO) EnableNodeGrant(tx *dbs.Tx, id uint32) (rowsAffected int64, err error) {
	return this.Query(tx).
		Pk(id).
		Set("state", NodeGrantStateEnabled).
		Update()
}

// DisableNodeGrant 禁用条目
func (this *NodeGrantDAO) DisableNodeGrant(tx *dbs.Tx, id int64) (err error) {
	_, err = this.Query(tx).
		Pk(id).
		Set("state", NodeGrantStateDisabled).
		Update()
	return err
}

// FindEnabledNodeGrant 查找启用中的条目
func (this *NodeGrantDAO) FindEnabledNodeGrant(tx *dbs.Tx, id int64) (*NodeGrant, error) {
	result, err := this.Query(tx).
		Pk(id).
		Attr("state", NodeGrantStateEnabled).
		Find()
	if result == nil {
		return nil, err
	}
	var grant = result.(*NodeGrant)
	grant.Password = openGrantSecret(grant.Password)
	grant.PrivateKey = openGrantSecret(grant.PrivateKey)
	grant.Passphrase = openGrantSecret(grant.Passphrase)
	return grant, err
}

// FindNodeGrantName 根据主键查找名称
func (this *NodeGrantDAO) FindNodeGrantName(tx *dbs.Tx, id uint32) (string, error) {
	name, err := this.Query(tx).
		Pk(id).
		Result("name").
		FindCol("")
	return name.(string), err
}

// CreateGrant 创建认证信息
func (this *NodeGrantDAO) CreateGrant(tx *dbs.Tx, adminId int64, name string, method string, username string, password string, privateKey string, passphrase string, description string, nodeId int64, su bool) (grantId int64, err error) {
	var op = NewNodeGrantOperator()
	op.AdminId = adminId
	op.Name = name
	op.Method = method

	switch method {
	case "user":
		op.Username = username
		sealedPassword, sealErr := sealGrantSecret(password)
		if sealErr != nil {
			return 0, sealErr
		}
		op.Password = sealedPassword
	case "privateKey":
		op.Username = username
		sealedPrivateKey, sealErr := sealGrantSecret(privateKey)
		if sealErr != nil {
			return 0, sealErr
		}
		op.PrivateKey = sealedPrivateKey

		sealedPassphrase, sealErr := sealGrantSecret(passphrase)
		if sealErr != nil {
			return 0, sealErr
		}
		op.Passphrase = sealedPassphrase
	}
	if username != "root" { // only for non-root user
		op.Su = su
	}
	op.Description = description
	op.NodeId = nodeId
	op.State = NodeGrantStateEnabled
	err = this.Save(tx, op)
	return types.Int64(op.Id), err
}

// UpdateGrant 修改认证信息
func (this *NodeGrantDAO) UpdateGrant(tx *dbs.Tx, grantId int64, name string, method string, username string, password string, privateKey string, passphrase string, description string, nodeId int64, su bool) error {
	if grantId <= 0 {
		return errors.New("invalid grantId")
	}

	var op = NewNodeGrantOperator()
	op.Id = grantId
	op.Name = name
	op.Method = method

	switch method {
	case "user":
		op.Username = username
		sealedPassword, sealErr := sealGrantSecret(password)
		if sealErr != nil {
			return sealErr
		}
		op.Password = sealedPassword
	case "privateKey":
		op.Username = username
		sealedPrivateKey, sealErr := sealGrantSecret(privateKey)
		if sealErr != nil {
			return sealErr
		}
		op.PrivateKey = sealedPrivateKey

		sealedPassphrase, sealErr := sealGrantSecret(passphrase)
		if sealErr != nil {
			return sealErr
		}
		op.Passphrase = sealedPassphrase
	}
	if username != "root" { // only for non-root user
		op.Su = su
	} else {
		op.Su = false
	}
	op.Description = description
	op.NodeId = nodeId
	err := this.Save(tx, op)
	return err
}

// CountAllEnabledGrants 计算所有认证信息数量
func (this *NodeGrantDAO) CountAllEnabledGrants(tx *dbs.Tx, keyword string) (int64, error) {
	query := this.Query(tx).
		State(NodeGrantStateEnabled)
	if len(keyword) > 0 {
		query.Where("(name LIKE :keyword OR username LIKE :keyword OR description LIKE :keyword)").
			Param("keyword", dbutils.QuoteLike(keyword))
	}
	return query.Count()
}

// ListEnabledGrants 列出单页的认证信息
func (this *NodeGrantDAO) ListEnabledGrants(tx *dbs.Tx, keyword string, offset int64, size int64) (result []*NodeGrant, err error) {
	query := this.Query(tx).
		State(NodeGrantStateEnabled)
	if len(keyword) > 0 {
		query.Where("(name LIKE :keyword OR username LIKE :keyword OR description LIKE :keyword)").
			Param("keyword", dbutils.QuoteLike(keyword))
	}
	_, err = query.
		Offset(offset).
		Size(size).
		DescPk().
		Slice(&result).
		FindAll()
	return
}

// FindAllEnabledGrants 列出所有的认证信息
func (this *NodeGrantDAO) FindAllEnabledGrants(tx *dbs.Tx) (result []*NodeGrant, err error) {
	_, err = this.Query(tx).
		State(NodeGrantStateEnabled).
		DescPk().
		Slice(&result).
		FindAll()
	return
}

// MigrateLegacySecrets 将历史明文password/privateKey/passphrase批量封存为实例密钥
// 加密后的数据。幂等：已封存的字段不再匹配过滤条件，重复执行（例如每次启动）代价很小。
// 仅记录处理的数量，不记录凭据内容。
func (this *NodeGrantDAO) MigrateLegacySecrets(tx *dbs.Tx) error {
	const batchSize = 200
	var likePattern = sealed.Prefix + "%"
	var total = 0
	for {
		var rows []*NodeGrant
		_, err := this.Query(tx).
			Result("id", "password", "privateKey", "passphrase").
			Where("(LENGTH(password)>0 AND password NOT LIKE :likePattern) OR (LENGTH(privateKey)>0 AND privateKey NOT LIKE :likePattern) OR (LENGTH(passphrase)>0 AND passphrase NOT LIKE :likePattern)").
			Param("likePattern", likePattern).
			Limit(batchSize).
			Slice(&rows).
			FindAll()
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			break
		}

		for _, row := range rows {
			var query = this.Query(tx).Pk(row.Id)
			var changed = false

			if len(row.Password) > 0 && !sealed.IsSealed(row.Password) {
				sealedValue, sealErr := sealed.Seal([]byte(row.Password))
				if sealErr != nil {
					return sealErr
				}
				query.Set("password", sealedValue)
				changed = true
			}
			if len(row.PrivateKey) > 0 && !sealed.IsSealed(row.PrivateKey) {
				sealedValue, sealErr := sealed.Seal([]byte(row.PrivateKey))
				if sealErr != nil {
					return sealErr
				}
				query.Set("privateKey", sealedValue)
				changed = true
			}
			if len(row.Passphrase) > 0 && !sealed.IsSealed(row.Passphrase) {
				sealedValue, sealErr := sealed.Seal([]byte(row.Passphrase))
				if sealErr != nil {
					return sealErr
				}
				query.Set("passphrase", sealedValue)
				changed = true
			}

			if changed {
				updateErr := query.UpdateQuickly()
				if updateErr != nil {
					return updateErr
				}
				total++
			}
		}
	}
	if total > 0 {
		logs.Println("[NODE_GRANT]sealed " + types.String(total) + " legacy node grant secret row(s)")
	}
	return nil
}
