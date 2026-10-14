package csrf

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"github.com/TeaOSLab/EdgeAdmin/internal/configs"
	"github.com/iwind/TeaGo/types"
	"strconv"
	"time"
)

// Generate 生成Token
func Generate() string {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)

	h := sha256.New()
	h.Write([]byte(configs.Secret))
	h.Write([]byte(timestamp))
	s := h.Sum(nil)
	token := base64.StdEncoding.EncodeToString([]byte(timestamp + fmt.Sprintf("%x", s)))
	sharedTokenManager.Put(token)
	return token
}

// Validate 校验Token，校验后无论成功与否都会使该Token失效（一次性使用）。
// 用于页面自身声明的CSRF参数校验（actionutils.CSRF）。
func Validate(token string) (b bool) {
	if len(token) == 0 {
		return
	}

	if !sharedTokenManager.Exists(token) {
		return
	}
	defer func() {
		sharedTokenManager.Delete(token)
	}()

	return checkTokenFormat(token)
}

// Peek 校验Token是否有效，但不会使其失效，可重复调用。
// 用于全局CSRF中间件对尚未声明CSRF参数的Action做统一校验：这类Action
// 不会再单独调用Validate()消费该Token，所以这里不消费，避免跟页面自身
// （如果有）的Validate()校验互相抢占同一个Token。
func Peek(token string) bool {
	if len(token) == 0 {
		return false
	}

	if !sharedTokenManager.Exists(token) {
		return false
	}

	return checkTokenFormat(token)
}

// checkTokenFormat 校验Token的HMAC签名与有效期，不涉及一次性消费逻辑
func checkTokenFormat(token string) bool {
	data, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return false
	}

	hashString := string(data)
	if len(hashString) < 10+32 {
		return false
	}

	timestampString := hashString[:10]
	hashString = hashString[10:]

	h := sha256.New()
	h.Write([]byte(configs.Secret))
	h.Write([]byte(timestampString))
	hashData := h.Sum(nil)
	if hashString != fmt.Sprintf("%x", hashData) {
		return false
	}

	timestamp := types.Int64(timestampString)
	if timestamp < time.Now().Unix()-1800 { // 有效期半个小时
		return false
	}

	return true
}
