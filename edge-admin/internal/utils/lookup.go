package utils

import (
	"errors"
	teaconst "github.com/TeaOSLab/EdgeAdmin/internal/const"
	"github.com/TeaOSLab/EdgeCommon/pkg/configutils"
	"github.com/iwind/TeaGo/logs"
	"github.com/miekg/dns"
	"sync"
)

var sharedDNSClient *dns.Client
var sharedDNSConfig *dns.ClientConfig

func init() {
	if !teaconst.IsMain {
		return
	}

	config, err := dns.ClientConfigFromFile("/etc/resolv.conf")
	if err != nil {
		logs.Println("ERROR: configure dns client failed: " + err.Error())
		return
	}

	sharedDNSConfig = config
	sharedDNSClient = &dns.Client{}
}

// LookupCNAME 获取CNAME
func LookupCNAME(host string) (string, error) {
	var m = new(dns.Msg)

	m.SetQuestion(host+".", dns.TypeCNAME)
	m.RecursionDesired = true

	var lastErr error
	var success = false
	var result = ""

	if sharedDNSConfig == nil || sharedDNSClient == nil {
		return "", errors.New("dns client has not been configured")
	}

	// only use the resolvers configured on this system
	var serverAddrs = sharedDNSConfig.Servers

	var wg = &sync.WaitGroup{}

	for _, serverAddr := range serverAddrs {
		wg.Add(1)

		go func(serverAddr string) {
			defer wg.Done()
			r, _, err := sharedDNSClient.Exchange(m, configutils.QuoteIP(serverAddr)+":"+sharedDNSConfig.Port)
			if err != nil {
				lastErr = err
				return
			}

			success = true

			if len(r.Answer) == 0 {
				return
			}

			result = r.Answer[0].(*dns.CNAME).Target
		}(serverAddr)
	}
	wg.Wait()

	if success {
		return result, nil
	}

	return "", lastErr
}
