package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"math/big"
	"os"
	"path/filepath"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/config"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gopkg.in/yaml.v3"
)

const userNodeName = "hcdn-console-api"

// bootstrap creates (or finds) the EdgeAPI user node whose API token
// console-api uses for every customer call, then prints or stores it.
func bootstrap(ctx context.Context, cfg *config.Config, args []string) error {
	fs := flag.NewFlagSet("bootstrap", flag.ExitOnError)
	write := fs.Bool("write", false, "write the credential into the config file (mode 0600)")
	sqlOnly := fs.Bool("sql", false, "do not call EdgeAPI; print SQL for a manual install")
	_ = fs.Parse(args)

	var nodeID, secret string
	var err error
	if !*sqlOnly {
		nodeID, secret, err = bootstrapRPC(ctx, cfg)
	}
	if *sqlOnly || isUnimplemented(err) {
		if err != nil {
			fmt.Fprintln(os.Stderr, "EdgeAPI does not implement UserNodeService; falling back to manual SQL.")
		}
		nodeID, secret = randomHex(16), randomAlnum(32)
		fmt.Printf(`-- Run against the EdgeAPI database (edgeUserNodes + edgeAPITokens), EdgeAPI caches API tokens briefly;
-- allow about a minute before starting console-api.
INSERT INTO edgeUserNodes (isOn, uniqueId, secret, name, description, accessAddrs, `+"`order`"+`, state, createdAt, adminId, weight)
  VALUES (1, '%[1]s', '%[2]s', '%[3]s', 'Hcdn console-api (BFF)', '[]', 0, 1, UNIX_TIMESTAMP(), 0, 0);
INSERT INTO edgeAPITokens (nodeId, secret, role, state) VALUES ('%[1]s', '%[2]s', 'user', 1);
`, nodeID, secret, userNodeName)
		err = nil
	}
	if err != nil {
		return err
	}
	if *write {
		if err := writeUserCredential(cfg.Path(), nodeID, secret); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "edgeAPI.user written to %s\n", cfg.Path())
		return nil
	}
	fmt.Printf("\n# add to %s:\nedgeAPI:\n  user:\n    nodeId: %q\n    secret: %q\n", cfg.Path(), nodeID, secret)
	return nil
}

func isUnimplemented(err error) bool {
	st, ok := status.FromError(err)
	return ok && err != nil && st.Code() == codes.Unimplemented
}

func bootstrapRPC(ctx context.Context, cfg *config.Config) (string, string, error) {
	if !cfg.EdgeAPI.Admin.Valid() {
		return "", "", errors.New("edgeAPI.admin credential is required for bootstrap (or use -sql)")
	}
	edge, err := newEdge(cfg)
	if err != nil {
		return "", "", err
	}
	defer edge.Close()
	call, err := edge.AsAdmin(ctx, cfg.EdgeAPI.AdminID)
	if err != nil {
		return "", "", err
	}
	defer call.Done()
	svc := call.UserNode()

	all, err := svc.FindAllEnabledUserNodes(call.Ctx, &pb.FindAllEnabledUserNodesRequest{})
	if err != nil {
		return "", "", err
	}
	var id int64
	for _, n := range all.UserNodes {
		if n.Name == userNodeName {
			id = n.Id
			break
		}
	}
	if id == 0 {
		created, err := svc.CreateUserNode(call.Ctx, &pb.CreateUserNodeRequest{
			Name:            userNodeName,
			Description:     "Hcdn console-api (BFF)",
			AccessAddrsJSON: []byte("[]"),
			IsOn:            true,
		})
		if err != nil {
			return "", "", err
		}
		id = created.UserNodeId
		fmt.Fprintf(os.Stderr, "created EdgeAPI user node #%d\n", id)
	} else {
		fmt.Fprintf(os.Stderr, "reusing EdgeAPI user node #%d\n", id)
	}
	found, err := svc.FindEnabledUserNode(call.Ctx, &pb.FindEnabledUserNodeRequest{UserNodeId: id})
	if err != nil {
		return "", "", err
	}
	if found.UserNode == nil || found.UserNode.UniqueId == "" || found.UserNode.Secret == "" {
		return "", "", errors.New("EdgeAPI did not return the user node credential")
	}
	return found.UserNode.UniqueId, found.UserNode.Secret, nil
}

// writeUserCredential sets edgeAPI.user.{nodeId,secret} keeping the rest of the
// YAML (and its comments) intact, then writes atomically with mode 0600.
func writeUserCredential(path, nodeID, secret string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return err
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return errors.New("config root is not a mapping")
	}
	edge := mapChild(doc.Content[0], "edgeAPI")
	user := mapChild(edge, "user")
	setScalar(user, "nodeId", nodeID)
	setScalar(user, "secret", secret)
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&doc); err != nil {
		return err
	}
	out := buf.Bytes()
	tmp, err := os.CreateTemp(filepath.Dir(path), ".console-api-*.yaml")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_ = tmp.Chmod(0o600) // best-effort on Windows
	if _, err := tmp.Write(out); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func mapChild(m *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			if m.Content[i+1].Kind != yaml.MappingNode {
				m.Content[i+1] = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			}
			return m.Content[i+1]
		}
	}
	child := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	m.Content = append(m.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, child)
	return child
}

func setScalar(m *yaml.Node, key, value string) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value, Style: yaml.DoubleQuotedStyle}
			return
		}
	}
	m.Content = append(m.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value, Style: yaml.DoubleQuotedStyle})
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func randomAlnum(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	out := make([]byte, n)
	for i := range out {
		v, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			panic(err)
		}
		out[i] = alphabet[v.Int64()]
	}
	return string(out)
}
