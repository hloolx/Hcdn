package nodes

import (
	"github.com/TeaOSLab/EdgeAPI/internal/db/models"
	"github.com/TeaOSLab/EdgeAPI/internal/utils/sealed"
	"github.com/iwind/TeaGo/logs"
)

// migrateSealedSecrets is a one-time, idempotent startup step that seals any
// sensitive database columns still holding data written before per-instance
// encryption was introduced: SSL certificate private keys, SSH node grant
// credentials and database node passwords (the latter also upgraded away
// from the retired global MagicKey encoding). It is safe to run on every
// start: rows already sealed no longer match the "legacy" filters used here,
// so later runs are a fast no-op. Only row counts are logged, never secret
// values.
func (this *APINode) migrateSealedSecrets() {
	logs.Println("[API_NODE]sealing legacy secrets using instance key at '" + sealed.KeyPath() + "' ...")

	if err := models.SharedSSLCertDAO.MigrateLegacyKeyData(nil); err != nil {
		logs.Println("[API_NODE]seal legacy ssl cert keyData failed: " + err.Error())
	}
}
