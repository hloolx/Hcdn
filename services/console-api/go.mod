module github.com/hloolx/Hcdn/services/console-api

go 1.26

toolchain go1.26.4

require (
	github.com/TeaOSLab/EdgeCommon v0.0.0-00010101000000-000000000000
	github.com/go-sql-driver/mysql v1.7.0
	google.golang.org/grpc v1.63.1
	gopkg.in/yaml.v3 v3.0.1
)

require (
	golang.org/x/net v0.24.0 // indirect
	golang.org/x/sys v0.19.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240228224816-df926f6c8641 // indirect
	google.golang.org/protobuf v1.33.0 // indirect
)

replace github.com/TeaOSLab/EdgeCommon => ../../edge-common
