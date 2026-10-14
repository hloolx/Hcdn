package firewallconfigs

type FirewallActionType = string

const (
	FirewallActionTypeIPSet     FirewallActionType = "ipset"
	FirewallActionTypeFirewalld FirewallActionType = "firewalld"
	FirewallActionTypeIPTables  FirewallActionType = "iptables"
	FirewallActionTypeScript    FirewallActionType = "script"
	FirewallActionTypeHTTPAPI   FirewallActionType = "httpAPI"
	FirewallActionTypeHTML      FirewallActionType = "html"
)

type FirewallActionTypeDefinition struct {
	Name        string             `json:"name"`
	Code        FirewallActionType `json:"code"`
	Description string             `json:"description"`
}

// FindAllFirewallActionTypes 返回可以通过管理界面创建的防火墙动作类型。
//
// "script" 和 "httpAPI" 两种类型有意不在此列出：它们分别会在节点上执行一个
// 由配置下发的路径/内容所指向的本地脚本，或请求一个由配置下发的任意URL，一旦
// 控制面（API）被攻破或者误配置，等同于在所有节点上获得任意命令执行/SSRF能力。
// 节点侧仍保留对这两种历史类型的解析以兼容已有配置（并在 action_script.go 中
// 增加了脚本路径必须位于 Tea.Root/scripts/ 之内的限制），但不再作为新建选项提供。
func FindAllFirewallActionTypes() []*FirewallActionTypeDefinition {
	return []*FirewallActionTypeDefinition{
		{
			Name:        "ipset",
			Code:        FirewallActionTypeIPSet,
			Description: "使用特定的ipset管理IP，可以结合iptables和firewalld等工具一起工作。",
		},
		{
			Name:        "firewalld",
			Code:        FirewallActionTypeFirewalld,
			Description: "使用Firewalld管理IP，非持久保存，reload之后重置规则。",
		},
		{
			Name:        "iptables",
			Code:        FirewallActionTypeIPTables,
			Description: "使用IPTables管理IP，不支持超时时间设定，非持久保存，reload之后重置规则。",
		},
		{
			Name:        "显示HTML内容",
			Code:        FirewallActionTypeHTML,
			Description: "显示一段自定义的HTML网页内容",
		},
	}
}

func FindFirewallActionTypeName(actionType FirewallActionType) string {
	for _, a := range FindAllFirewallActionTypes() {
		if a.Code == actionType {
			return a.Name
		}
	}
	return ""
}

type FirewallActionIPSetConfig struct {
	Path string `json:"path"` // 命令路径 TODO 暂时不实现

	WhiteName string `json:"whiteName"` // IPSet白名单名称
	BlackName string `json:"blackName"` // IPSet黑名单名称

	WhiteNameIPv6 string `json:"whiteNameIPv6"` // IPv6白名单名称
	BlackNameIPv6 string `json:"blackNameIPv6"` // IPv6黑名单名称

	MaxElements        int  `json:"maxElements"`        // 最多IP数量 TODO 暂时不实现
	AutoAddToIPTables  bool `json:"autoAddToIPTables"`  // 是否自动创建IPTables规则
	AutoAddToFirewalld bool `json:"autoAddToFirewalld"` // 是否自动加入到Firewalld

	// TODO 添加需要阻止的端口列表
}

type FirewallActionFirewalldConfig struct {
	Path string `json:"path"` // 命令路径 TODO 暂时不实现

	// TODO 添加需要阻止的端口列表
}

type FirewallActionIPTablesConfig struct {
	Path string `json:"path"` // 命令路径 TODO 暂时不实现

	// TODO 添加需要阻止的端口列表
}

type FirewallActionScriptConfig struct {
	Path string   `json:"path"` // 脚本路径
	Cwd  string   `json:"cwd"`  // 工作目录 TODO 暂时不实现
	Args []string `json:"args"` // 附加参数 TODO 暂时不实现

	// TODO 添加需要阻止的端口列表
}

// FirewallActionHTTPAPIConfig HTTP API配置
type FirewallActionHTTPAPIConfig struct {
	URL            string `json:"url"`            // URL路径
	TimeoutSeconds int    `json:"timeoutSeconds"` // 超时时间 TODO 暂时不实现
	Secret         string `json:"secret"`         // 认证密钥 TODO 暂时不实现

	// TODO 添加需要阻止的端口列表
}

// FirewallActionHTMLConfig HTML配置
type FirewallActionHTMLConfig struct {
	Content string `json:"content"` // 完整的HTML内容
}
