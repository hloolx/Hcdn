package nodes

import (
	"github.com/iwind/TeaGo/dbs"
	"github.com/iwind/TeaGo/logs"
	"github.com/iwind/TeaGo/types"
)

// widenPasswordColumns makes sure edgeAdmins.password and edgeUsers.password
// can hold bcrypt hashes (FIX-15). sql.json declares varchar(255), but the
// schema sync only runs when the stored SQL version is older than the binary,
// so instances installed at 1.3.9 keep the original varchar(32) and every
// bcrypt write fails with "Data too long". Idempotent: columns that are
// already wide enough are left alone.
func (this *APINode) widenPasswordColumns() {
	db, err := dbs.Default()
	if err != nil {
		logs.Println("[API_NODE]widen password columns: " + err.Error())
		return
	}
	for _, table := range []string{"edgeAdmins", "edgeUsers"} {
		one, err := db.FindOne("SELECT CHARACTER_MAXIMUM_LENGTH AS l FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='password'", table)
		if err != nil || one == nil {
			if err != nil {
				logs.Println("[API_NODE]widen password columns: " + err.Error())
			}
			continue
		}
		if types.Int(one.GetString("l")) >= 255 {
			continue
		}
		_, err = db.Exec("ALTER TABLE `" + table + "` MODIFY `password` varchar(255) DEFAULT NULL COMMENT '密码'")
		if err != nil {
			logs.Println("[API_NODE]widen " + table + ".password failed: " + err.Error())
			continue
		}
		logs.Println("[API_NODE]widened " + table + ".password to varchar(255)")
	}
}
