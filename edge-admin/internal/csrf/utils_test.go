package csrf

import (
	"testing"
)

func TestGenerateAndValidate(t *testing.T) {
	var token = Generate()
	if len(token) == 0 {
		t.Fatal("expected non-empty token")
	}

	if !Validate(token) {
		t.Fatal("expected first Validate() to succeed")
	}

	// Validate()是一次性的：第二次校验同一个token应当失败
	if Validate(token) {
		t.Fatal("expected second Validate() of the same token to fail (one-time use)")
	}
}

func TestPeekDoesNotConsume(t *testing.T) {
	var token = Generate()

	for i := 0; i < 3; i++ {
		if !Peek(token) {
			t.Fatalf("expected Peek() #%d to succeed", i+1)
		}
	}

	// Peek()之后Validate()仍然应该成功（Peek不消费token）
	if !Validate(token) {
		t.Fatal("expected Validate() after Peek()s to still succeed")
	}

	// 而Validate()之后token才真正失效
	if Peek(token) {
		t.Fatal("expected Peek() after Validate() to fail")
	}
}

func TestValidateRejectsUnknownOrEmptyToken(t *testing.T) {
	if Validate("") {
		t.Fatal("expected empty token to fail")
	}
	if Validate("this-token-was-never-issued") {
		t.Fatal("expected unknown token to fail")
	}
	if Peek("") {
		t.Fatal("expected empty token to fail Peek()")
	}
	if Peek("this-token-was-never-issued") {
		t.Fatal("expected unknown token to fail Peek()")
	}
}
