package configs

import (
	"github.com/iwind/TeaGo/Tea"
	"os"
	"testing"
)

// withTempConfigDir redirects Tea.ConfigFile()/Tea.ConfigDir() to a fresh temp
// directory for the duration of the test, restoring the original value after.
func withTempConfigDir(t *testing.T) string {
	var original = Tea.ConfigDir()
	t.Cleanup(func() {
		Tea.SetConfigDir(original)
	})

	dir, err := os.MkdirTemp("", "edge-admin-install-marker-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})

	Tea.SetConfigDir(dir)
	return dir
}

func TestIsInstalled_MarkInstalled(t *testing.T) {
	withTempConfigDir(t)

	if IsInstalled() {
		t.Fatal("expected IsInstalled() to be false before MarkInstalled() is ever called")
	}

	if err := MarkInstalled(); err != nil {
		t.Fatal(err)
	}

	if !IsInstalled() {
		t.Fatal("expected IsInstalled() to be true after MarkInstalled()")
	}

	// 标记文件应当存在（请求的权限是0600；Windows文件系统不保留Unix权限位，
	// 这里不对具体权限值做跨平台断言，0600参数本身已经在源码里写明）
	if _, err := os.Stat(Tea.ConfigFile(InstalledMarkerFileName)); err != nil {
		t.Fatal(err)
	}

	// 重复调用应当是安全的（可重复、幂等）
	if err := MarkInstalled(); err != nil {
		t.Fatal(err)
	}
	if !IsInstalled() {
		t.Fatal("expected IsInstalled() to still be true after a second MarkInstalled()")
	}
}
