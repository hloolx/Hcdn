//go:build !windows

package dbutils

import "golang.org/x/sys/unix"

// availableSpaceGB returns the free space (in GiB) of the filesystem holding dir.
func availableSpaceGB(dir string) (uint64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(dir, &stat); err != nil {
		return 0, err
	}
	return (stat.Bavail * uint64(stat.Bsize)) / (1 << 30), nil
}
