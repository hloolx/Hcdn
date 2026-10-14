package utils

import (
	"archive/zip"
	"errors"
	"github.com/TeaOSLab/EdgeAPI/internal/utils/pathsafety"
	"io"
	"os"
)

// Permissions applied to extracted entries, ignoring whatever mode bits the
// archive entry itself claims - which may include setuid/setgid/sticky bits
// or otherwise be overly permissive (FIX-02/FIX-43).
const (
	safeExtractDirMode  os.FileMode = 0755
	safeExtractFileMode os.FileMode = 0644
)

type Unzip struct {
	zipFile   string
	targetDir string
}

func NewUnzip(zipFile string, targetDir string) *Unzip {
	return &Unzip{
		zipFile:   zipFile,
		targetDir: targetDir,
	}
}

func (this *Unzip) Run() error {
	if len(this.zipFile) == 0 {
		return errors.New("zip file should not be empty")
	}
	if len(this.targetDir) == 0 {
		return errors.New("target dir should not be empty")
	}

	reader, err := zip.OpenReader(this.zipFile)
	if err != nil {
		return err
	}

	defer func() {
		_ = reader.Close()
	}()

	for _, file := range reader.File {
		info := file.FileInfo()

		// FIX-02/FIX-43: never trust an archive entry's path - clean it and
		// make sure it stays inside targetDir ("zip slip" protection).
		target, err := pathsafety.SafeJoin(this.targetDir, file.Name)
		if err != nil {
			return err
		}

		// 目录
		if info.IsDir() {
			stat, err := os.Stat(target)
			if err != nil {
				if !os.IsNotExist(err) {
					return err
				} else {
					err = os.MkdirAll(target, safeExtractDirMode)
					if err != nil {
						return err
					}
				}
			} else if !stat.IsDir() {
				err = os.MkdirAll(target, safeExtractDirMode)
				if err != nil {
					return err
				}
			}
			continue
		}

		// 文件
		err = func(file *zip.File, target string) error {
			fileReader, err := file.Open()
			if err != nil {
				return err
			}
			defer func() {
				_ = fileReader.Close()
			}()

			fileWriter, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, safeExtractFileMode)
			if err != nil {
				return err
			}
			defer func() {
				_ = fileWriter.Close()
			}()

			_, err = io.Copy(fileWriter, fileReader)
			return err
		}(file, target)
		if err != nil {
			return err
		}
	}

	return nil
}
