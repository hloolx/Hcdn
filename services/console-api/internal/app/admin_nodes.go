package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

// ---------------------------------------------------------------- nodes

type nodeSummary struct {
	ID           int64    `json:"id"`
	Name         string   `json:"name"`
	ClusterID    int64    `json:"clusterId"`
	ClusterName  string   `json:"clusterName"`
	IPs          []string `json:"ips"`
	IsOn         bool     `json:"isOn"`
	IsUp         bool     `json:"isUp"`
	IsInstalled  bool     `json:"isInstalled"`
	Region       string   `json:"region"`
	Version      string   `json:"version"`
	CPU          *float64 `json:"cpu"`
	Memory       *float64 `json:"memory"`
	Load1        *float64 `json:"load1"`
	Connections  *int64   `json:"connections"`
	BandwidthBps *int64   `json:"bandwidthBps"`
	UpdatedAt    *int64   `json:"updatedAt"`
}

type nodeStatus struct {
	BuildVersion    string  `json:"buildVersion"`
	CPUUsage        float64 `json:"cpuUsage"`
	MemoryUsage     float64 `json:"memoryUsage"`
	Load1m          float64 `json:"load1m"`
	ConnectionCount int64   `json:"connectionCount"`
	TrafficOutBytes int64   `json:"trafficOutBytes"`
	UpdatedAt       int64   `json:"updatedAt"`
	IsActive        bool    `json:"isActive"`
}

func (a *App) toNodeSummary(n *pb.Node, ips []string) nodeSummary {
	out := nodeSummary{ID: n.Id, Name: n.Name, IsOn: n.IsOn, IsInstalled: n.IsInstalled, IPs: ips}
	if out.IPs == nil {
		out.IPs = []string{}
	}
	if n.NodeCluster != nil {
		out.ClusterID, out.ClusterName = n.NodeCluster.Id, n.NodeCluster.Name
	}
	if n.NodeRegion != nil {
		out.Region = n.NodeRegion.Name
	}
	var st nodeStatus
	if len(n.StatusJSON) > 0 && json.Unmarshal(n.StatusJSON, &st) == nil && st.UpdatedAt > 0 {
		online := st.IsActive && a.now().Unix()-st.UpdatedAt <= 60
		out.IsUp = online && n.IsUp && n.IsOn
		out.Version = st.BuildVersion
		cpu, mem, load := st.CPUUsage, st.MemoryUsage, st.Load1m
		conns := st.ConnectionCount
		bw := st.TrafficOutBytes * 8 / 60 // trafficOutBytes covers the last minute
		upd := st.UpdatedAt
		out.CPU, out.Memory, out.Load1, out.Connections, out.BandwidthBps, out.UpdatedAt = &cpu, &mem, &load, &conns, &bw, &upd
	}
	return out
}

func nodeIPs(call *edgeapi.Call, nodeID int64) ([]*pb.NodeIPAddress, error) {
	resp, err := call.NodeIPAddress().FindAllEnabledNodeIPAddressesWithNodeId(call.Ctx, &pb.FindAllEnabledNodeIPAddressesWithNodeIdRequest{NodeId: nodeID, Role: "node"})
	if err != nil {
		return nil, err
	}
	return resp.NodeIPAddresses, nil
}

func ipStrings(addrs []*pb.NodeIPAddress) []string {
	out := []string{}
	for _, ad := range addrs {
		if ad.IsOn {
			out = append(out, ad.Ip)
		}
	}
	return out
}

func (a *App) summarizeNodes(call *edgeapi.Call, nodes []*pb.Node) []nodeSummary {
	out := make([]nodeSummary, len(nodes))
	parallel(len(nodes), 8, func(i int) {
		addrs, _ := nodeIPs(call, nodes[i].Id)
		out[i] = a.toNodeSummary(nodes[i], ipStrings(addrs))
	})
	return out
}

func (a *App) adminCall(r *http.Request, p *principal) (*edgeapi.Call, error) {
	return a.edge.AsAdmin(r.Context(), p.id())
}

func (a *App) adminNodes(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	q := r.URL.Query()
	req := &pb.ListEnabledNodesMatchRequest{
		Keyword:       strings.TrimSpace(q.Get("keyword")),
		NodeClusterId: httpx.QueryInt(r, "clusterId", 0),
		Offset:        (page - 1) * size,
		Size:          size,
	}
	switch q.Get("status") {
	case "online":
		req.ActiveState = 1
	case "offline":
		req.ActiveState = 2
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	cnt, err := call.Node().CountAllEnabledNodesMatch(call.Ctx, &pb.CountAllEnabledNodesMatchRequest{
		Keyword: req.Keyword, NodeClusterId: req.NodeClusterId, ActiveState: req.ActiveState,
	})
	if err != nil {
		return err
	}
	list, err := call.Node().ListEnabledNodesMatch(call.Ctx, req)
	if err != nil {
		return err
	}
	nodes := list.Nodes
	if q.Get("status") == "disabled" {
		// EdgeAPI has no isOn filter; filter the page locally.
		var f []*pb.Node
		for _, n := range nodes {
			if !n.IsOn {
				f = append(f, n)
			}
		}
		nodes = f
	}
	return writeJSON(w, httpx.Page[nodeSummary]{Items: a.summarizeNodes(call, nodes), Total: cnt.Count, Page: page, PageSize: size})
}

type nodeDetail struct {
	nodeSummary
	Series     []nodePoint `json:"series"`
	DNSRecords []string    `json:"dnsRecords"`
}

type nodePoint struct {
	T            int64   `json:"t"`
	CPU          float64 `json:"cpu"`
	Memory       float64 `json:"memory"`
	BandwidthBps int64   `json:"bandwidthBps"`
	Connections  int64   `json:"connections"`
}

func findNode(call *edgeapi.Call, id int64) (*pb.Node, error) {
	resp, err := call.Node().FindEnabledNode(call.Ctx, &pb.FindEnabledNodeRequest{NodeId: id})
	if err != nil {
		return nil, err
	}
	if resp.Node == nil {
		return nil, httpx.NotFound()
	}
	return resp.Node, nil
}

func (a *App) adminNode(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	n, err := findNode(call, id)
	if err != nil {
		return err
	}
	addrs, err := nodeIPs(call, id)
	if err != nil {
		return err
	}
	out := nodeDetail{nodeSummary: a.toNodeSummary(n, ipStrings(addrs)), Series: []nodePoint{}, DNSRecords: []string{}}

	// Last 60 minutes of node values, merged per minute.
	points := map[int64]*nodePoint{}
	get := func(t int64) *nodePoint {
		t -= t % 60
		if pt, ok := points[t]; ok {
			return pt
		}
		pt := &nodePoint{T: t}
		points[t] = pt
		return pt
	}
	for _, item := range []string{"cpu", "memory", "trafficOut", "connections"} {
		resp, err := call.NodeValue().ListNodeValues(call.Ctx, &pb.ListNodeValuesRequest{Role: "node", NodeId: id, Item: item, Range: "minute"})
		if err != nil {
			continue
		}
		for _, v := range resp.NodeValues {
			var m map[string]float64
			if json.Unmarshal(v.ValueJSON, &m) != nil {
				continue
			}
			pt := get(v.CreatedAt)
			switch item {
			case "cpu":
				pt.CPU = m["usage"]
			case "memory":
				pt.Memory = m["usage"]
			case "trafficOut":
				pt.BandwidthBps = int64(m["total"] * 8 / 60)
			case "connections":
				pt.Connections = int64(m["total"])
			}
		}
	}
	for _, pt := range points {
		out.Series = append(out.Series, *pt)
	}
	sort.Slice(out.Series, func(i, j int) bool { return out.Series[i].T < out.Series[j].T })

	if out.ClusterID > 0 {
		if dns, err := call.NodeCluster().FindEnabledNodeClusterDNS(call.Ctx, &pb.FindEnabledNodeClusterDNSRequest{NodeClusterId: out.ClusterID}); err == nil && dns.Domain != nil && dns.Name != "" {
			fqdn := dns.Name + "." + dns.Domain.Name
			for _, ip := range out.IPs {
				typ := "A"
				if strings.Contains(ip, ":") {
					typ = "AAAA"
				}
				out.DNSRecords = append(out.DNSRecords, fqdn+" "+typ+" "+ip)
			}
		}
	}
	return writeJSON(w, out)
}

func normalizeNodeIPs(in []string, f httpx.Fields) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		ad, err := netip.ParseAddr(s)
		if err != nil {
			f.Add("ips", "IP 格式不正确："+s)
			continue
		}
		v := ad.Unmap().String()
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	if len(out) > 32 {
		f.Add("ips", "最多 32 个 IP")
	}
	return out
}

func (a *App) apiEndpoints(call *edgeapi.Call) []string {
	out := []string{}
	resp, err := call.APINode().FindAllEnabledAPINodes(call.Ctx, &pb.FindAllEnabledAPINodesRequest{})
	if err != nil {
		return out
	}
	for _, n := range resp.ApiNodes {
		if n.IsOn {
			out = append(out, n.AccessAddrs...)
		}
	}
	return out
}

func (a *App) adminCreateNode(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		ClusterID int64    `json:"clusterId"`
		Name      string   `json:"name"`
		IPs       []string `json:"ips"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len([]rune(req.Name)) > 64 {
		f.Add("name", "名称为 1-64 个字符")
	}
	if req.ClusterID <= 0 {
		f.Add("clusterId", "请选择集群")
	}
	ips := normalizeNodeIPs(req.IPs, f)
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	created, err := call.Node().CreateNode(call.Ctx, &pb.CreateNodeRequest{Name: req.Name, NodeClusterId: req.ClusterID})
	if err != nil {
		return err
	}
	for _, ip := range ips {
		if _, err := call.NodeIPAddress().CreateNodeIPAddress(call.Ctx, &pb.CreateNodeIPAddressRequest{
			NodeId: created.NodeId, Role: "node", Name: ip, Ip: ip, CanAccess: true, IsUp: true,
		}); err != nil {
			return err
		}
	}
	n, err := findNode(call, created.NodeId)
	if err != nil {
		return err
	}
	a.auditAdmin(r, p, "创建节点 "+req.Name)
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"node":    a.toNodeSummary(n, ips),
		"install": map[string]any{"nodeId": n.UniqueId, "secret": n.Secret, "endpoints": a.apiEndpoints(call)},
	})
	return nil
}

func (a *App) adminUpdateNode(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		Name *string   `json:"name"`
		IsOn *bool     `json:"isOn"`
		IPs  *[]string `json:"ips"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	var ips []string
	if req.IPs != nil {
		ips = normalizeNodeIPs(*req.IPs, f)
	}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || len([]rune(n)) > 64 {
			f.Add("name", "名称为 1-64 个字符")
		}
		req.Name = &n
	}
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	n, err := findNode(call, id)
	if err != nil {
		return err
	}
	if req.Name != nil && *req.Name != n.Name {
		// UpdateNode overwrites every field: send the current values back.
		var clusterID, groupID, regionID int64
		if n.NodeCluster != nil {
			clusterID = n.NodeCluster.Id
		}
		if n.NodeGroup != nil {
			groupID = n.NodeGroup.Id
		}
		if n.NodeRegion != nil {
			regionID = n.NodeRegion.Id
		}
		var secondary []int64
		for _, c := range n.SecondaryNodeClusters {
			secondary = append(secondary, c.Id)
		}
		if _, err := call.Node().UpdateNode(call.Ctx, &pb.UpdateNodeRequest{
			NodeId: id, Name: *req.Name, NodeClusterId: clusterID, SecondaryNodeClusterIds: secondary,
			IsOn: n.IsOn, NodeGroupId: groupID, NodeRegionId: regionID, Level: n.Level, LnAddrs: n.LnAddrs,
			EnableIPLists: n.EnableIPLists,
		}); err != nil {
			return err
		}
	}
	if req.IsOn != nil && *req.IsOn != n.IsOn {
		if _, err := call.Node().UpdateNodeIsOn(call.Ctx, &pb.UpdateNodeIsOnRequest{NodeId: id, IsOn: *req.IsOn}); err != nil {
			return err
		}
	}
	if req.IPs != nil {
		addrs, err := nodeIPs(call, id)
		if err != nil {
			return err
		}
		have := map[string]bool{}
		for _, ad := range addrs {
			keep := false
			for _, ip := range ips {
				if ip == ad.Ip {
					keep = true
				}
			}
			if !keep {
				if _, err := call.NodeIPAddress().DisableNodeIPAddress(call.Ctx, &pb.DisableNodeIPAddressRequest{NodeIPAddressId: ad.Id}); err != nil {
					return err
				}
				continue
			}
			have[ad.Ip] = true
		}
		for _, ip := range ips {
			if !have[ip] {
				if _, err := call.NodeIPAddress().CreateNodeIPAddress(call.Ctx, &pb.CreateNodeIPAddressRequest{
					NodeId: id, Role: "node", Name: ip, Ip: ip, CanAccess: true, IsUp: true,
				}); err != nil {
					return err
				}
			}
		}
	}
	a.auditAdmin(r, p, "修改节点 #"+strconv.FormatInt(id, 10))
	n, err = findNode(call, id)
	if err != nil {
		return err
	}
	addrs, _ := nodeIPs(call, id)
	return writeJSON(w, a.toNodeSummary(n, ipStrings(addrs)))
}

func (a *App) adminDeleteNode(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	n, err := findNode(call, id)
	if err != nil {
		return err
	}
	if _, err := call.Node().DeleteNode(call.Ctx, &pb.DeleteNodeRequest{NodeId: id}); err != nil {
		return err
	}
	a.auditAdmin(r, p, "删除节点 "+n.Name)
	return noContent(w)
}

// ---------------------------------------------------------------- clusters

type clusterResp struct {
	ID              int64  `json:"id"`
	Name            string `json:"name"`
	NodesCount      int64  `json:"nodesCount"`
	OnlineNodes     int64  `json:"onlineNodes"`
	SitesCount      int64  `json:"sitesCount"`
	DNSDomain       string `json:"dnsDomain"`
	DNSName         string `json:"dnsName"`
	DNSProviderName string `json:"dnsProviderName"`
	IsDefault       bool   `json:"isDefault"`
}

func (a *App) clusterInfo(call *edgeapi.Call, id int64, name string, defaultID int64) clusterResp {
	c := clusterResp{ID: id, Name: name, IsDefault: id == defaultID}
	if r, err := call.Node().CountAllEnabledNodesMatch(call.Ctx, &pb.CountAllEnabledNodesMatchRequest{NodeClusterId: id}); err == nil {
		c.NodesCount = r.Count
	}
	if r, err := call.Node().CountAllEnabledNodesMatch(call.Ctx, &pb.CountAllEnabledNodesMatchRequest{NodeClusterId: id, ActiveState: 1}); err == nil {
		c.OnlineNodes = r.Count
	}
	if r, err := call.Server().CountAllEnabledServersWithNodeClusterId(call.Ctx, &pb.CountAllEnabledServersWithNodeClusterIdRequest{NodeClusterId: id}); err == nil {
		c.SitesCount = r.Count
	}
	if dns, err := call.NodeCluster().FindEnabledNodeClusterDNS(call.Ctx, &pb.FindEnabledNodeClusterDNSRequest{NodeClusterId: id}); err == nil {
		c.DNSName = dns.Name
		if dns.Domain != nil {
			c.DNSDomain = dns.Domain.Name
		}
		if dns.Provider != nil {
			c.DNSProviderName = dns.Provider.Name
		}
	}
	return c
}

func (a *App) adminDefaultCluster(ctx context.Context) int64 {
	id, err := a.defaultClusterID(ctx)
	if err != nil {
		return 0
	}
	return id
}

func (a *App) adminClusters(w http.ResponseWriter, r *http.Request, p *principal) error {
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.NodeCluster().FindAllEnabledNodeClusters(call.Ctx, &pb.FindAllEnabledNodeClustersRequest{})
	if err != nil {
		return err
	}
	def := a.adminDefaultCluster(r.Context())
	out := make([]clusterResp, len(resp.NodeClusters))
	parallel(len(resp.NodeClusters), 8, func(i int) {
		c := resp.NodeClusters[i]
		out[i] = a.clusterInfo(call, c.Id, c.Name, def)
	})
	return writeJSON(w, out)
}

func (a *App) adminCreateCluster(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 64 {
		return httpx.Validation(map[string]string{"name": "名称为 1-64 个字符"})
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	// Policy ids 0: EdgeAPI creates default cache and WAF policies.
	resp, err := call.NodeCluster().CreateNodeCluster(call.Ctx, &pb.CreateNodeClusterRequest{
		Name: name, SystemServicesJSON: []byte(`{"systemd":{"isOn":true}}`),
	})
	if err != nil {
		return err
	}
	a.auditAdmin(r, p, "创建集群 "+name)
	httpx.WriteJSON(w, http.StatusCreated, a.clusterInfo(call, resp.NodeClusterId, name, a.adminDefaultCluster(r.Context())))
	return nil
}

func findCluster(call *edgeapi.Call, id int64) (*pb.NodeCluster, error) {
	resp, err := call.NodeCluster().FindEnabledNodeCluster(call.Ctx, &pb.FindEnabledNodeClusterRequest{NodeClusterId: id})
	if err != nil {
		return nil, err
	}
	if resp.NodeCluster == nil {
		return nil, httpx.NotFound()
	}
	return resp.NodeCluster, nil
}

func (a *App) adminUpdateCluster(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		Name *string `json:"name"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	c, err := findCluster(call, id)
	if err != nil {
		return err
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || len([]rune(name)) > 64 {
			return httpx.Validation(map[string]string{"name": "名称为 1-64 个字符"})
		}
		// UpdateNodeCluster overwrites all fields: pass the current ones.
		if _, err := call.NodeCluster().UpdateNodeCluster(call.Ctx, &pb.UpdateNodeClusterRequest{
			NodeClusterId: id, Name: name, NodeGrantId: c.NodeGrantId, InstallDir: c.InstallDir, TimeZone: c.TimeZone,
			NodeMaxThreads: c.NodeMaxThreads, AutoOpenPorts: c.AutoOpenPorts, ClockJSON: c.ClockJSON,
			AutoRemoteStart: c.AutoRemoteStart, AutoInstallNftables: c.AutoInstallNftables, SshParamsJSON: c.SshParamsJSON,
			AutoSystemTuning: c.AutoSystemTuning, AutoTrimDisks: c.AutoTrimDisks,
			MaxConcurrentReads: c.MaxConcurrentReads, MaxConcurrentWrites: c.MaxConcurrentWrites,
		}); err != nil {
			return err
		}
		c.Name = name
		a.auditAdmin(r, p, "修改集群 #"+strconv.FormatInt(id, 10))
	}
	return writeJSON(w, a.clusterInfo(call, id, c.Name, a.adminDefaultCluster(r.Context())))
}

var dnsLabelRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

func (a *App) adminClusterDNS(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		DomainID int64  `json:"domainId"`
		DNSName  string `json:"dnsName"`
		TTL      int32  `json:"ttl"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	req.DNSName = strings.ToLower(strings.TrimSpace(req.DNSName))
	f := httpx.Fields{}
	if req.DomainID <= 0 {
		f.Add("domainId", "请选择域名")
	}
	if !dnsLabelRe.MatchString(req.DNSName) {
		f.Add("dnsName", "子域名只能包含小写字母、数字和短横线")
	}
	if req.TTL < 0 || req.TTL > 86400 {
		f.Add("ttl", "TTL 范围为 0-86400")
	}
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	c, err := findCluster(call, id)
	if err != nil {
		return err
	}
	used, err := call.NodeCluster().CheckNodeClusterDNSName(call.Ctx, &pb.CheckNodeClusterDNSNameRequest{NodeClusterId: id, DnsName: req.DNSName})
	if err != nil {
		return err
	}
	if used.IsUsed {
		return httpx.Validation(map[string]string{"dnsName": "该子域名已被其他集群使用"})
	}
	cur, err := call.NodeCluster().FindEnabledNodeClusterDNS(call.Ctx, &pb.FindEnabledNodeClusterDNSRequest{NodeClusterId: id})
	if err != nil {
		return err
	}
	nodesSync, serversSync := cur.NodesAutoSync, cur.ServersAutoSync
	if cur.Domain == nil { // first binding: keep records in sync automatically
		nodesSync, serversSync = true, true
	}
	if _, err := call.NodeCluster().UpdateNodeClusterDNS(call.Ctx, &pb.UpdateNodeClusterDNSRequest{
		NodeClusterId: id, DnsName: req.DNSName, DnsDomainId: req.DomainID, NodesAutoSync: nodesSync,
		ServersAutoSync: serversSync, CnameRecords: cur.CnameRecords, Ttl: req.TTL, CnameAsDomain: cur.CnameAsDomain,
		IncludingLnNodes: cur.IncludingLnNodes,
	}); err != nil {
		return err
	}
	a.dnsMu.Lock()
	delete(a.dnsCache, id)
	a.dnsMu.Unlock()
	a.auditAdmin(r, p, "设置集群 "+c.Name+" 的 DNS")
	return writeJSON(w, a.clusterInfo(call, id, c.Name, a.adminDefaultCluster(r.Context())))
}

// ---------------------------------------------------------------- dashboard

type adminAlert struct {
	ID      string `json:"id"`
	Level   string `json:"level"`
	Title   string `json:"title"`
	Message string `json:"message"`
	Time    int64  `json:"time"`
}

func (a *App) adminDashboard(w http.ResponseWriter, r *http.Request, p *principal) error {
	tr, err := parseRange(r.URL.Query().Get("range"))
	if err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	dash, err := call.Admin().ComposeAdminDashboard(call.Ctx, &pb.ComposeAdminDashboardRequest{})
	if err != nil {
		return err
	}
	now := a.now()
	rep := &statsReport{Range: tr.name, Series: []trafficPoint{}, StatusCodes: []statusCodeCount{}, Regions: []regionStat{}, TopSites: []topSite{}}

	// Hourly stats cover 24 h, daily stats 15 days.
	var all []trafficPoint
	if tr.dur <= 24*time.Hour {
		rep.Step = 3600
		for _, s := range dash.HourlyTrafficStats {
			t, err := time.ParseInLocation("2006010215", s.Hour, time.Local)
			if err != nil {
				continue
			}
			all = append(all, trafficPoint{T: t.Unix(), Bytes: s.Bytes, CachedBytes: s.CachedBytes, Requests: s.CountRequests,
				CachedRequests: s.CountCachedRequests, AttackRequests: s.CountAttackRequests, BandwidthBps: s.Bytes * 8 / 3600})
		}
	} else {
		rep.Step = 86400
		for _, s := range dash.DailyTrafficStats {
			t, err := time.ParseInLocation("20060102", s.Day, time.Local)
			if err != nil {
				continue
			}
			all = append(all, trafficPoint{T: t.Unix(), Bytes: s.Bytes, CachedBytes: s.CachedBytes, Requests: s.CountRequests,
				CachedRequests: s.CountCachedRequests, AttackRequests: s.CountAttackRequests, BandwidthBps: s.Bytes * 8 / 86400})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].T < all[j].T })
	cut := now.Add(-tr.dur).Unix()
	prevCut := now.Add(-2 * tr.dur).Unix()
	var prev trafficTotals
	hasPrev := false
	for _, pt := range all {
		switch {
		case pt.T >= cut:
			rep.Series = append(rep.Series, pt)
			addTotals(&rep.Totals, pt)
		case pt.T >= prevCut:
			hasPrev = true
			addTotals(&prev, pt)
		}
	}
	if hasPrev {
		rep.Previous = &prev
	}
	for _, d := range dash.TopDomainStats {
		rep.TopSites = append(rep.TopSites, topSite{SiteID: d.ServerId, Domain: d.Domain, Bytes: d.Bytes, Requests: d.CountRequests})
	}

	out := map[string]any{}
	data, _ := json.Marshal(rep)
	_ = json.Unmarshal(data, &out)
	out["nodes"] = map[string]int64{"total": dash.CountNodes, "online": dash.CountNodes - dash.CountOfflineNodes, "offline": dash.CountOfflineNodes}
	users := map[string]int64{"total": dash.CountUsers, "newThisWeek": 0}
	if ub, err := call.User().ComposeUserGlobalBoard(call.Ctx, &pb.ComposeUserGlobalBoardRequest{}); err == nil {
		users["total"], users["newThisWeek"] = ub.TotalUsers, ub.CountWeeklyUsers
	}
	out["users"] = users
	out["sitesCount"] = dash.CountServers
	var expiring int64
	for _, userOnly := range []bool{true, false} {
		if c, err := call.SSLCert().CountSSLCerts(call.Ctx, &pb.CountSSLCertRequest{ExpiringDays: 30, UserOnly: userOnly}); err == nil {
			expiring += c.Count
		}
	}
	out["certsExpiringSoon"] = expiring

	// Node health: offline nodes first, then by CPU.
	health := []nodeSummary{}
	if list, err := call.Node().ListEnabledNodesMatch(call.Ctx, &pb.ListEnabledNodesMatchRequest{Offset: 0, Size: 50, CpuDesc: true}); err == nil {
		health = a.summarizeNodes(call, list.Nodes)
		sort.SliceStable(health, func(i, j int) bool { return !health[i].IsUp && health[j].IsUp })
		if len(health) > 20 {
			health = health[:20]
		}
	}
	out["nodeHealth"] = health

	alerts := []adminAlert{}
	for _, n := range health {
		if n.IsOn && !n.IsUp {
			alerts = append(alerts, adminAlert{ID: "node-offline-" + strconv.FormatInt(n.ID, 10), Level: "critical",
				Title: "节点离线", Message: "节点 " + n.Name + " 已离线", Time: now.Unix()})
		}
		if n.CPU != nil && *n.CPU > 0.9 {
			alerts = append(alerts, adminAlert{ID: "node-cpu-" + strconv.FormatInt(n.ID, 10), Level: "warning",
				Title: "CPU 过高", Message: "节点 " + n.Name + " CPU 使用率超过 90%", Time: now.Unix()})
		}
	}
	if expiring > 0 {
		alerts = append(alerts, adminAlert{ID: "certs-expiring", Level: "warning", Title: "证书即将过期",
			Message: strconv.FormatInt(expiring, 10) + " 张证书将在 30 天内过期", Time: now.Unix()})
	}
	if dash.NodeUpgradeInfo != nil && dash.NodeUpgradeInfo.CountNodes > 0 {
		alerts = append(alerts, adminAlert{ID: "node-upgrade", Level: "info", Title: "节点可升级",
			Message: strconv.FormatInt(dash.NodeUpgradeInfo.CountNodes, 10) + " 个节点可升级到 " + dash.NodeUpgradeInfo.NewVersion, Time: now.Unix()})
	}
	out["alerts"] = alerts
	return writeJSON(w, out)
}

func addTotals(t *trafficTotals, p trafficPoint) {
	t.Bytes += p.Bytes
	t.CachedBytes += p.CachedBytes
	t.Requests += p.Requests
	t.CachedRequests += p.CachedRequests
	t.AttackRequests += p.AttackRequests
	t.PeakBandwidthBps = max(t.PeakBandwidthBps, p.BandwidthBps)
}
