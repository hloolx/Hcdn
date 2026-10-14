package encrypt

// legacyDBNodePasswordKey is the AES-256-CFB key (key = this string, IV =
// its first 16 bytes) that GoEdge historically hard-coded to "encrypt"
// edgeDBNodes.password. It shipped in the public source tree, so it never
// provided real confidentiality - anyone with the source can decrypt every
// row encoded with it.
//
// It is kept ONLY so DecodeLegacyDBNodePassword can do a one-time decrypt of
// rows written before this fix, immediately followed by re-sealing with the
// per-instance secret key (see internal/utils/sealed and DBNodeDAO). Do not
// use this key for anything new, and do not reintroduce an "encode" sibling
// for it.
const legacyDBNodePasswordKey = "f1c8eafb543f03023e97b7be864a4e9b"

// DecodeLegacyDBNodePassword decrypts a value produced by the retired global
// MagicKey algorithm (DBNodeDAO's old EncodePassword/"EDGE_ENCODED:" values).
// It exists only for DBNodeDAO.DecodePassword and the one-time startup
// migration that re-seals legacy rows; never call it for new data.
func DecodeLegacyDBNodePassword(data []byte) ([]byte, error) {
	method, err := NewMethodInstance("aes-256-cfb", legacyDBNodePasswordKey, legacyDBNodePasswordKey[:16])
	if err != nil {
		return nil, err
	}
	return method.Decrypt(data)
}
