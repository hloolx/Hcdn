package models

import (
	"encoding/base64"
	"fmt"
	"github.com/TeaOSLab/EdgeAPI/internal/encrypt"
	"github.com/TeaOSLab/EdgeAPI/internal/errors"
	"github.com/TeaOSLab/EdgeAPI/internal/utils/sealed"
	"github.com/TeaOSLab/EdgeCommon/pkg/nodeconfigs"
	_ "github.com/go-sql-driver/mysql"
	"github.com/iwind/TeaGo/Tea"
	"github.com/iwind/TeaGo/dbs"
	"github.com/iwind/TeaGo/logs"
	"github.com/iwind/TeaGo/types"
	"strings"
)

const (
	DBNodeStateEnabled  = 1 // 已启用
	DBNodeStateDisabled = 0 // 已禁用
)

type DBNodeDAO dbs.DAO

const DBNodePasswordEncodedPrefix = "EDGE_ENCODED:"

// dbNodePasswordColumnMaxLen is edgeDBNodes.password's varchar width (see
// internal/setup/sql.json). Sealing adds ~28 bytes of AES-256-GCM overhead
// plus base64/prefix expansion, so EncodePassword refuses to produce a value
// longer than this rather than risk silent truncation by MySQL; in practice
// this only bites unusually long (~160+ character) passwords.
const dbNodePasswordColumnMaxLen = 255

func NewDBNodeDAO() *DBNodeDAO {
	return dbs.NewDAO(&DBNodeDAO{
		DAOObject: dbs.DAOObject{
			DB:     Tea.Env,
			Table:  "edgeDBNodes",
			Model:  new(DBNode),
			PkName: "id",
		},
	}).(*DBNodeDAO)
}

var SharedDBNodeDAO *DBNodeDAO

func init() {
	dbs.OnReady(func() {
		SharedDBNodeDAO = NewDBNodeDAO()
	})
}

// EnableDBNode 启用条目
func (this *DBNodeDAO) EnableDBNode(tx *dbs.Tx, id int64) error {
	_, err := this.Query(tx).
		Pk(id).
		Set("state", DBNodeStateEnabled).
		Update()
	return err
}

// DisableDBNode 禁用条目
func (this *DBNodeDAO) DisableDBNode(tx *dbs.Tx, nodeId int64) error {
	_, err := this.Query(tx).
		Pk(nodeId).
		Set("state", DBNodeStateDisabled).
		Update()
	if err != nil {
		return err
	}

	// 删除运行日志
	return SharedNodeLogDAO.DeleteNodeLogs(tx, nodeconfigs.NodeRoleDatabase, nodeId)
}

// FindEnabledDBNode 查找启用中的条目
func (this *DBNodeDAO) FindEnabledDBNode(tx *dbs.Tx, id int64) (*DBNode, error) {
	result, err := this.Query(tx).
		Pk(id).
		Attr("state", DBNodeStateEnabled).
		Find()
	if result == nil {
		return nil, err
	}
	node := result.(*DBNode)
	node.Password = this.DecodePassword(node.Password)
	return node, nil
}

// FindDBNodeName 根据主键查找名称
func (this *DBNodeDAO) FindDBNodeName(tx *dbs.Tx, id int64) (string, error) {
	return this.Query(tx).
		Pk(id).
		Result("name").
		FindStringCol("")
}

// CountAllEnabledNodes 计算可用的节点数量
func (this *DBNodeDAO) CountAllEnabledNodes(tx *dbs.Tx) (int64, error) {
	return this.Query(tx).
		State(DBNodeStateEnabled).
		Count()
}

// ListEnabledNodes 获取单页的节点
func (this *DBNodeDAO) ListEnabledNodes(tx *dbs.Tx, offset int64, size int64) (result []*DBNode, err error) {
	_, err = this.Query(tx).
		State(DBNodeStateEnabled).
		Offset(offset).
		Limit(size).
		Slice(&result).
		DescPk().
		FindAll()
	for _, node := range result {
		node.Password = this.DecodePassword(node.Password)
	}
	return
}

// CreateDBNode 创建节点
func (this *DBNodeDAO) CreateDBNode(tx *dbs.Tx, isOn bool, name string, description string, host string, port int32, database string, username string, password string, charset string) (int64, error) {
	var op = NewDBNodeOperator()
	op.State = NodeStateEnabled
	op.IsOn = isOn
	op.Name = name
	op.Description = description
	op.Host = host
	op.Port = port
	op.Database = database
	op.Username = username
	encodedPassword, err := this.EncodePassword(password)
	if err != nil {
		return 0, err
	}
	op.Password = encodedPassword
	op.Charset = charset
	err = this.Save(tx, op)
	if err != nil {
		return 0, err
	}
	return types.Int64(op.Id), nil
}

// UpdateNode 修改节点
func (this *DBNodeDAO) UpdateNode(tx *dbs.Tx, nodeId int64, isOn bool, name string, description string, host string, port int32, database string, username string, password string, charset string) error {
	if nodeId <= 0 {
		return errors.New("invalid nodeId")
	}
	var op = NewDBNodeOperator()
	op.Id = nodeId
	op.IsOn = isOn
	op.Name = name
	op.Description = description
	op.Host = host
	op.Port = port
	op.Database = database
	op.Username = username
	encodedPassword, err := this.EncodePassword(password)
	if err != nil {
		return err
	}
	op.Password = encodedPassword
	op.Charset = charset
	err = this.Save(tx, op)
	return err
}

// FindAllEnabledAndOnDBNodes 查找所有可用的数据库节点
func (this *DBNodeDAO) FindAllEnabledAndOnDBNodes(tx *dbs.Tx) (result []*DBNode, err error) {
	_, err = this.Query(tx).
		State(DBNodeStateEnabled).
		Attr("isOn", true).
		Slice(&result).
		DescPk().
		FindAll()
	for _, node := range result {
		node.Password = this.DecodePassword(node.Password)
	}
	return
}

// EncodePassword 封存密码（新数据一律使用实例密钥，不再使用已废弃的全局MagicKey）
func (this *DBNodeDAO) EncodePassword(password string) (string, error) {
	if len(password) == 0 {
		return "", nil
	}
	if strings.HasPrefix(password, DBNodePasswordEncodedPrefix) || sealed.IsSealed(password) {
		// 已经是旧算法编码或已封存的值，避免重复包装
		return password, nil
	}
	sealedValue, err := sealed.Seal([]byte(password))
	if err != nil {
		return "", err
	}
	if len(sealedValue) > dbNodePasswordColumnMaxLen {
		return "", fmt.Errorf("sealed password is %d characters long, which exceeds the edgeDBNodes.password column limit of %d", len(sealedValue), dbNodePasswordColumnMaxLen)
	}
	return sealedValue, nil
}

// DecodePassword 解密密码：优先处理实例密钥封存的数据；
// 对历史 EDGE_ENCODED: 前缀数据使用已废弃的旧算法做最后一次解密（仅用于迁移期间的兼容读取，
// 见 legacyDBNodePasswordKey 与 MigrateLegacyPasswords）
func (this *DBNodeDAO) DecodePassword(password string) string {
	if len(password) == 0 {
		return password
	}
	if strings.HasPrefix(password, DBNodePasswordEncodedPrefix) {
		dataString := password[len(DBNodePasswordEncodedPrefix):]
		data, err := base64.StdEncoding.DecodeString(dataString)
		if err != nil {
			logs.Println("[DB_NODE]decode legacy password failed: " + err.Error())
			return password
		}
		plain, err := encrypt.DecodeLegacyDBNodePassword(data)
		if err != nil {
			logs.Println("[DB_NODE]decode legacy password failed: " + err.Error())
			return password
		}
		return string(plain)
	}
	plain, err := sealed.Open(password)
	if err != nil {
		logs.Println("[DB_NODE]open sealed password failed: " + err.Error())
		return password
	}
	return string(plain)
}

// MigrateLegacyPasswords 将历史 EDGE_ENCODED: 前缀数据用旧算法解密一次后，
// 以实例密钥重新封存。幂等：已迁移的记录不再匹配 EDGE_ENCODED: 前缀，重复执行
// （例如每次启动）代价很小。仅记录处理的数量，不记录口令内容。
func (this *DBNodeDAO) MigrateLegacyPasswords(tx *dbs.Tx) error {
	const batchSize = 200
	var total = 0
	for {
		var rows []*DBNode
		_, err := this.Query(tx).
			Result("id", "password").
			Where("password LIKE :legacyPrefix").
			Param("legacyPrefix", DBNodePasswordEncodedPrefix+"%").
			Limit(batchSize).
			Slice(&rows).
			FindAll()
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			break
		}

		var progressed = false
		for _, row := range rows {
			plainPassword := this.DecodePassword(row.Password)
			if strings.HasPrefix(plainPassword, DBNodePasswordEncodedPrefix) {
				// 旧算法解密失败，保留原值以便人工排查，避免对同一行无限重试
				continue
			}

			sealedPassword, sealErr := this.EncodePassword(plainPassword)
			if sealErr != nil {
				// 例如封存后超出列宽度限制：跳过该行，留待人工处理，不中断本批其余记录
				logs.Println("[DB_NODE]skip sealing db node #" + types.String(row.Id) + " password: " + sealErr.Error())
				continue
			}
			updateErr := this.Query(tx).
				Pk(row.Id).
				Set("password", sealedPassword).
				UpdateQuickly()
			if updateErr != nil {
				return updateErr
			}
			total++
			progressed = true
		}
		if !progressed {
			break
		}
	}
	if total > 0 {
		logs.Println("[DB_NODE]sealed " + types.String(total) + " legacy db node password row(s)")
	}
	return nil
}

// CheckNodeIsOn 检查节点是否已经启用
func (this *DBNodeDAO) CheckNodeIsOn(tx *dbs.Tx, nodeId int64) (bool, error) {
	isOn, err := this.Query(tx).
		Pk(nodeId).
		Result("isOn").
		FindIntCol(0)
	if err != nil {
		return false, err
	}
	return isOn == 1, nil
}
