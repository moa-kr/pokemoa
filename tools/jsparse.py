"""Minimal JavaScript object/array literal parser (subset used by data.js).

Supports: objects with unquoted or quoted keys, arrays, double-quoted strings
with escapes, numbers, true/false/null, and trailing commas. Ignores line and
block comments.
"""
import json
import re


class P:
    def __init__(self, s, resolver=None):
        self.s = s
        self.i = 0
        self.resolver = resolver

    def ws(self):
        s, n = self.s, len(self.s)
        while self.i < n:
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif c == "/" and self.i + 1 < n and s[self.i + 1] == "/":
                j = s.find("\n", self.i)
                self.i = n if j < 0 else j + 1
            elif c == "/" and self.i + 1 < n and s[self.i + 1] == "*":
                j = s.find("*/", self.i + 2)
                self.i = n if j < 0 else j + 2
            else:
                break

    def value(self):
        self.ws()
        c = self.s[self.i]
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "\"'":
            return self.string()
        if c == "-" or c.isdigit():
            return self.number()
        ident = self.ident()
        if ident == "true":
            return True
        if ident == "false":
            return False
        if ident == "null":
            return None
        if self.resolver is not None:
            return self.resolver(ident)
        raise ValueError("unexpected ident %r at %d" % (ident, self.i))

    def ident(self):
        m = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", self.s[self.i:])
        if not m:
            raise ValueError("bad ident at %d: %r" % (self.i, self.s[self.i:self.i + 20]))
        self.i += m.end()
        return m.group(0)

    def string(self):
        q = self.s[self.i]
        i = self.i + 1
        out = []
        n = len(self.s)
        while i < n:
            c = self.s[i]
            if c == "\\":
                e = self.s[i + 1]
                mapping = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", '"': '"', "'": "'", "\\": "\\", "/": "/"}
                if e in mapping:
                    out.append(mapping[e])
                    i += 2
                elif e == "u":
                    out.append(chr(int(self.s[i + 2:i + 6], 16)))
                    i += 6
                else:
                    out.append(e)
                    i += 2
            elif c == q:
                self.i = i + 1
                return "".join(out)
            else:
                out.append(c)
                i += 1
        raise ValueError("unterminated string")

    def number(self):
        m = re.match(r"-?\d+(\.\d+)?([eE][+-]?\d+)?", self.s[self.i:])
        self.i += m.end()
        txt = m.group(0)
        return float(txt) if ("." in txt or "e" in txt.lower()) else int(txt)

    def obj(self):
        self.i += 1  # {
        d = {}
        while True:
            self.ws()
            if self.s[self.i] == "}":
                self.i += 1
                return d
            if self.s[self.i] in "\"'":
                k = self.string()
            else:
                k = self.ident()
            self.ws()
            if self.s[self.i] != ":":
                raise ValueError("expected ':' at %d %r" % (self.i, self.s[self.i:self.i + 30]))
            self.i += 1
            d[k] = self.value()
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1
            elif self.s[self.i] == "}":
                self.i += 1
                return d
            else:
                raise ValueError("expected , or } at %d %r" % (self.i, self.s[self.i:self.i + 30]))

    def arr(self):
        self.i += 1  # [
        a = []
        while True:
            self.ws()
            if self.s[self.i] == "]":
                self.i += 1
                return a
            a.append(self.value())
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1
            elif self.s[self.i] == "]":
                self.i += 1
                return a
            else:
                raise ValueError("expected , or ] at %d %r" % (self.i, self.s[self.i:self.i + 30]))


def extract(src, varname, _cache=None):
    """Extract `var NAME = <literal>;` and return the parsed value.

    Bare identifiers used as values are resolved against other `var NAME = ...`
    declarations in the same source.
    """
    cache = _cache if _cache is not None else {}
    if varname in cache:
        return cache[varname]
    m = re.search(r"var\s+" + re.escape(varname) + r"\s*=\s*", src)
    if not m:
        raise KeyError(varname)

    def resolve(name):
        return extract(src, name, cache)

    p = P(src, resolve)
    p.i = m.end()
    val = p.value()
    cache[varname] = val
    return val


if __name__ == "__main__":
    src = open("assets/js/data.js", encoding="utf-8").read()
    cache = {}
    data = extract(src, "SETS", cache)
    print("sets:", len(data), [s["id"] for s in data])
    for s in data:
        print(s["id"], s["short"], s["release"], len(s.get("cards", [])), s.get("total"))
