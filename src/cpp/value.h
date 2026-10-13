// SPDX-License-Identifier: Apache-2.0
//
// A JSON-like value: how the Python and the JavaScript bindings hand the shared C++ a nested
// structure (the STEP importer's B-rep data, step_build.cpp). Dictionary keys are strings; a
// missing key reads as none.

#pragma once

#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace smlibpy {

class Value
{
public:
    enum Kind { NONE, BOOL, NUMBER, STRING, LIST, DICT };

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
    static Value of(std::string s)
    {
        Value v;
        v.kind_ = STRING, v.s_ = std::move(s);
        return v;
    }
    static Value list(std::vector<Value> items)
    {
        Value v;
        v.kind_ = LIST, v.items_ = std::move(items);
        return v;
    }
    static Value dict(std::vector<std::pair<std::string, Value>> fields)
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
        if (kind_ != LIST || i >= items_.size())
            throw std::invalid_argument("expected a list of at least " + std::to_string(i + 1) + " items");
        return items_[i];
    }
    double num() const
    {
        if (kind_ == NUMBER)
            return n_;
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
        if (kind_ != LIST)
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

private:
    Kind kind_ = NONE;
    bool b_ = false;
    double n_ = 0.0;
    std::string s_;
    std::vector<Value> items_;
    std::vector<std::pair<std::string, Value>> fields_;
};

}  // namespace smlibpy
