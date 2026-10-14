package utils

import (
	cryptorand "crypto/rand"
	"encoding/hex"
)

// letterChars 字母数字字符集，和 github.com/iwind/TeaGo/rands.String() 保持一致，
// 这样替换调用点时生成的值格式不变。
const letterChars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// RandomString 生成指定长度、由加密安全随机数源（crypto/rand）驱动的随机字符串
// （字符集：数字+大小写字母）。用于替换历史上使用math/rand（可预测/可枚举）
// 生成的各类secret/token，例如管理端CSRF密钥、登录表单Token等（见FIX-16）。
//
// 如果底层crypto/rand不可用（操作系统熵源故障，正常环境下几乎不会发生），
// 会panic而不是静默降级为弱随机数——对于secret/token生成场景，静默降级本身
// 就是这个漏洞的成因，不应该重蹈覆辙。
func RandomString(n int) string {
	if n <= 0 {
		return ""
	}

	var randomBytes = make([]byte, n)
	_, err := cryptorand.Read(randomBytes)
	if err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}

	var result = make([]byte, n)
	for i, b := range randomBytes {
		result[i] = letterChars[int(b)%len(letterChars)]
	}
	return string(result)
}

// RandomHexString 生成指定长度、由加密安全随机数源（crypto/rand）驱动的16进制
// 随机字符串（字符集：[0-9a-f]），和 rands.HexString() 格式保持一致。
func RandomHexString(n int) string {
	if n <= 0 {
		return ""
	}

	var randomBytes = make([]byte, (n+1)/2)
	_, err := cryptorand.Read(randomBytes)
	if err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}

	return hex.EncodeToString(randomBytes)[:n]
}
