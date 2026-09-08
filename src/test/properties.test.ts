import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parsePropertyKeys } from "../properties";

function keys(text: string): string[] {
  return [...parsePropertyKeys(text)].sort();
}

test("reads plain key=value entries", () => {
  assert.deepEqual(keys("appTitle=My App\nbtn.save=Save\n"), ["appTitle", "btn.save"]);
});

test("ignores comments and blank lines", () => {
  assert.deepEqual(keys("#XTIT: title\n! bang comment\n\n  \nappTitle=My App\n"), ["appTitle"]);
});

test("trims whitespace around the separator", () => {
  assert.deepEqual(keys("appTitle = My App\nsub : Sub\n"), ["appTitle", "sub"]);
});

test("accepts whitespace as a separator", () => {
  assert.deepEqual(keys("appTitle My App\nbtn.save\tSave\n"), ["appTitle", "btn.save"]);
});

test("accepts a key with no value", () => {
  assert.deepEqual(keys("emptyKey=\nbareKey\n"), ["bareKey", "emptyKey"]);
});

test("stops at the first separator, not a later one in the value", () => {
  assert.deepEqual(keys("msg=Error: not found\nurl=http://example.com\n"), ["msg", "url"]);
});

test("handles escaped separators inside the key", () => {
  assert.deepEqual(keys(String.raw`my\=key=value` + "\n" + String.raw`my\ key=value` + "\n"), [
    "my key",
    "my=key",
  ]);
});

test("does not treat continuation lines as keys", () => {
  const text = ["long=first part \\", "second: part", "other=x", ""].join("\n");
  assert.deepEqual(keys(text), ["long", "other"]);
});

test("strips a UTF-8 BOM from the first key", () => {
  assert.deepEqual(keys("\uFEFFappTitle=My App\n"), ["appTitle"]);
});
