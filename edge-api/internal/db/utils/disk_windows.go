//go:build windows

package dbutils

import "errors"

// availableSpaceGB is not implemented on Windows (development builds only).
func availableSpaceGB(dir string) (uint64, error) {
	return 0, errors.New("not supported on windows")
}
