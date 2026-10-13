// SPDX-License-Identifier: Apache-2.0
//
// A JSON-like value: how the shared C++ and the Python and JavaScript bindings pass nested data
// both ways (the STEP importer's B-rep data in step_build.cpp; curve, surface and B-rep dumps out of
// ext.cpp). Dictionary keys are strings; a missing key reads as none. Integers and tuples are kinds
// of their own, so that Python gets back exactly the int and tuple types it got before.

#pragma once

#include <stdexcept>
#include <type_traits>
#include <string>
#include <utility>
#include <vector>

namespace smlibpy {

class Value
{
public:
    enum Kind { NONE, BOOL, INT, NUMBER, STRING, LIST, TUPLE, DICT };

    Value() = default;
    static Value of(bool b)
    {
        Value v;
        v.kind_ = BOOL, v.b_ = b;
        return v;
    }
    static Value of(double n)
    {
        Value v;
        v.kind_ = NUMBER, v.n_ = n;
        return v;
    }
    static Value integer(long long i)
    {
        Value v;
        v.kind_ = INT, v.i_ = i;
        return v;
    }
    static Value of(std::string s)
    {
        Value v;
        v.kind_ = STRING, v.s_ = std::move(s);
        return v;
    }
    static Value make_list(std::vector<Value> items = {})
    {
        Value v;
        v.kind_ = LIST, v.items_ = std::move(items);
        return v;
    }
    static Value tuple(std::vector<Value> items)
    {
        Value v;
        v.kind_ = TUPLE, v.items_ = std::move(items);
        return v;
    }
    static Value dict(std::vector<std::pair<std::string, Value>> fields = {})
    {
        Value v;
        v.kind_ = DICT, v.fields_ = std::move(fields);
        return v;
    }

    Kind kind() const { return kind_; }
    bool is_none() const { return kind_ == NONE; }
    // A key that is there and not none.
    bool has(const std::string& key) const { return !(*this)[key].is_none(); }
    const Value& operator[](const std::string& key) const
    {
        static const Value none;
        if (kind_ != DICT)
            throw std::invalid_argument("expected a dictionary with '" + key + "'");
        for (const auto& f : fields_)
            if (f.first == key)
                return f.second;
        return none;
    }
    const Value& at(size_t i) const
    {
        if ((kind_ != LIST && kind_ != TUPLE) || i >= items_.size())
            throw std::invalid_argument("expected a list of at least " + std::to_string(i + 1) + " items");
        return items_[i];
    }
    double num() const
    {
        if (kind_ == NUMBER)
            return n_;
        if (kind_ == INT)
            return static_cast<double>(i_);
        if (kind_ == BOOL)
            return b_ ? 1.0 : 0.0;
        throw std::invalid_argument("expected a number");
    }
    bool boolean() const
    {
        if (kind_ == BOOL)
            return b_;
        if (kind_ == NUMBER)
            return n_ != 0.0;
        if (kind_ == INT)
            return i_ != 0;
        throw std::invalid_argument("expected a boolean");
    }
    const std::string& str() const
    {
        if (kind_ != STRING)
            throw std::invalid_argument("expected a string");
        return s_;
    }
    const std::vector<Value>& list() const
    {
        if (kind_ != LIST && kind_ != TUPLE)
            throw std::invalid_argument("expected a list");
        return items_;
    }
    std::vector<double> nums() const
    {
        std::vector<double> out;
        out.reserve(list().size());
        for (const Value& v : items_)
            out.push_back(v.num());
        return out;
    }

    // building
    Value& set(const std::string& key, Value v)
    {
        if (kind_ == NONE)
            kind_ = DICT;
        if (kind_ != DICT)
            throw std::invalid_argument("set: not a dictionary");
        for (auto& f : fields_)
            if (f.first == key)
            {
                f.second = std::move(v);
                return *this;
            }
        fields_.emplace_back(key, std::move(v));
        return *this;
    }
    Value& push(Value v)
    {
        if (kind_ != LIST && kind_ != TUPLE)
            throw std::invalid_argument("push: not a list");
        items_.push_back(std::move(v));
        return *this;
    }

    // reading, for the bindings' conversions
    bool flag() const { return b_; }
    long long int_value() const { return i_; }
    double number_value() const { return n_; }
    const std::string& string_value() const { return s_; }
    const std::vector<Value>& items() const { return items_; }
    const std::vector<std::pair<std::string, Value>>& fields() const { return fields_; }

private:
    Kind kind_ = NONE;
    bool b_ = false;
    long long i_ = 0;
    double n_ = 0.0;
    std::string s_;
    std::vector<Value> items_;
    std::vector<std::pair<std::string, Value>> fields_;
};

// A value from a C++ one: booleans, integers, floating point numbers and strings by their type;
// a Value as it is.
template <typename T>
Value v(const T& x)
{
    if constexpr (std::is_same_v<T, Value>)
        return x;
    else if constexpr (std::is_same_v<T, bool>)
        return Value::of(x);
    else if constexpr (std::is_integral_v<T>)
        return Value::integer(static_cast<long long>(x));
    else if constexpr (std::is_floating_point_v<T>)
        return Value::of(static_cast<double>(x));
    else
        return Value::of(std::string(x));
}

template <typename... A>
Value tup(const A&... a)
{
    return Value::tuple({v(a)...});
}

}  // namespace smlibpy
