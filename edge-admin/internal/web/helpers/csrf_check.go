package helpers

import (
	"github.com/TeaOSLab/EdgeAdmin/internal/csrf"
	"github.com/iwind/TeaGo/actions"
	"net/http"
	"net/url"
	"strings"
)

// CSRFHeaderName 全局CSRF校验使用的请求头名称。
//
// 页面首次GET渲染时，服务端在teaCSRFToken里下发一个Token（见@layout.html等
// 页面的window.TEA.ACTION.data），前端公共请求层web/public/js/vue.tea.js的
// Tea.Action._post()会自动把它放进这个请求头，随每一次POST/GET请求一起发送。
// 这样不需要逐个页面模板添加<csrf-token>组件或隐藏表单字段即可覆盖全部Action。
const CSRFHeaderName = "X-Csrf-Token"

// GenerateCSRFToken 生成一个新的CSRF Token，在GET渲染已登录页面时调用一次，
// 写入action.Data供模板下发给前端（见helpers.userMustAuth.BeforeAction）。
func GenerateCSRFToken() string {
	return csrf.Generate()
}

// CheckCSRF 校验当前请求携带的CSRF请求头是否有效。
//
// 使用Peek()而非Validate()：
//  1. 同一个页面内可能会连续发起多次写请求，而这个Token只在页面GET渲染时
//     下发一次，并不会随每次POST刷新，所以不能一次性消费掉；
//  2. 部分Action自己还声明了CSRF *actionutils.CSRF参数，对放在表单里的
//     csrfToken字段做一次性校验（会消费该Token）——两者校验的是不同的
//     Token（一个走请求头，一个走表单字段），互不干扰，但统一使用Peek()
//     更保守、不会产生任何因校验顺序导致的误判。
func CheckCSRF(action *actions.ActionObject) bool {
	return csrf.Peek(action.Request.Header.Get(CSRFHeaderName))
}

// CheckCSRFOrigin 校验Origin/Referer（如果浏览器发送了的话）与当前请求Host是否一致，
// 作为CSRF Token校验之外的第二层防护。两者都未发送时不做阻拦，以兼容不发送这些
// 请求头的合法客户端（如内部脚本持有效session调用）。
func CheckCSRFOrigin(request *http.Request) bool {
	var host = request.Host

	if origin := request.Header.Get("Origin"); len(origin) > 0 {
		u, err := url.Parse(origin)
		if err != nil || len(u.Host) == 0 {
			return false
		}
		return strings.EqualFold(u.Host, host)
	}

	if referer := request.Header.Get("Referer"); len(referer) > 0 {
		u, err := url.Parse(referer)
		if err != nil || len(u.Host) == 0 {
			return false
		}
		return strings.EqualFold(u.Host, host)
	}

	return true
}
