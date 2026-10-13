// SPDX-License-Identifier: Apache-2.0
//
// Values (src/cpp/value.h) to and from JavaScript: dictionaries as objects, lists and tuples as
// arrays, none as null, integers and numbers as numbers.

#pragma once

#include "common.h"
#include "value.h"

namespace smjs {

inline val to_js(const smlibpy::Value& v)
{
    using smlibpy::Value;
    switch (v.kind())
    {
    case Value::NONE: return val::null();
    case Value::BOOL: return val(v.flag());
    case Value::INT: return val(static_cast<double>(v.int_value()));
    case Value::NUMBER: return val(v.number_value());
    case Value::STRING: return val(v.string_value());
    case Value::LIST:
    case Value::TUPLE:
    {
        val out = val::array();
        for (const Value& item : v.items())
            out.call<void>("push", to_js(item));
        return out;
    }
    case Value::DICT:
    {
        val out = val::object();
        for (const auto& f : v.fields())
            out.set(f.first, to_js(f.second));
        return out;
    }
    }
    return val::null();
}

inline smlibpy::Value from_js(const val& v)
{
    using smlibpy::Value;
    if (v.isNull() || v.isUndefined())
        return {};
    const std::string type = v.typeOf().as<std::string>();
    if (type == "boolean")
        return Value::of(v.as<bool>());
    if (type == "number")
        return Value::of(v.as<double>());
    if (type == "string")
        return Value::of(v.as<std::string>());
    if (val::global("Array").call<bool>("isArray", v) || val::global("ArrayBuffer").call<bool>("isView", v))
    {
        std::vector<Value> items;
        const unsigned n = v["length"].as<unsigned>();
        items.reserve(n);
        for (unsigned i = 0; i < n; ++i)
            items.push_back(from_js(v[i]));
        return Value::make_list(std::move(items));
    }
    if (type == "object")
    {
        std::vector<std::pair<std::string, Value>> fields;
        const val keys = val::global("Object").call<val>("keys", v);
        const unsigned n = keys["length"].as<unsigned>();
        for (unsigned i = 0; i < n; ++i)
        {
            const std::string key = keys[i].as<std::string>();
            fields.emplace_back(key, from_js(v[key]));
        }
        return Value::dict(std::move(fields));
    }
    throw_error("unsupported value of type " + type);
}

}  // namespace smjs
