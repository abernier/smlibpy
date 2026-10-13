// SPDX-License-Identifier: Apache-2.0
//
// Values (value.h) to and from Python, for the Python bindings of the shared C++ (only included
// behind SMLIBPY_PYTHON). Python gets back the types it gave: ints, floats, tuples and lists.

#pragma once

#include "ext.h"
#include "value.h"

namespace smlibpy {

// Python data as a Value, read the way pybind11 reads it: Python and numpy booleans, ints, numbers
// (numpy scalars too), strings, dicts (keys as their str), tuples and other sequences (numpy arrays
// by row).
inline Value to_value(py::handle h)
{
    if (h.is_none())
        return {};
    if (py::isinstance<py::bool_>(h))
        return Value::of(h.cast<bool>());
    if (py::isinstance<py::str>(h))
        return Value::of(h.cast<std::string>());
    if (py::isinstance<py::dict>(h))
    {
        std::vector<std::pair<std::string, Value>> fields;
        for (auto kv : h.cast<py::dict>())
            fields.emplace_back(py::str(kv.first).cast<std::string>(), to_value(kv.second));
        return Value::dict(std::move(fields));
    }
    if (py::isinstance<py::int_>(h))
        return Value::integer(h.cast<long long>());
    if (py::isinstance<py::float_>(h))
        return Value::of(h.cast<double>());
    // (a numpy array has __float__ too, for one element: sequences first, a 0-d array a number)
    const bool scalar_array = py::hasattr(h, "ndim") && h.attr("ndim").cast<int>() == 0;
    if (!scalar_array && (py::isinstance<py::sequence>(h) || py::isinstance<py::iterable>(h)))
    {
        std::vector<Value> items;
        for (auto item : h)
            items.push_back(to_value(item));
        return py::isinstance<py::tuple>(h) ? Value::tuple(std::move(items)) : Value::make_list(std::move(items));
    }
    if (py::hasattr(h, "__float__"))  // numpy scalars and booleans
        return Value::of(h.cast<double>());
    throw py::type_error("unsupported value of type " + py::str(py::type::of(h)).cast<std::string>());
}

inline py::object to_python(const Value& v)
{
    switch (v.kind())
    {
    case Value::NONE: return py::none();
    case Value::BOOL: return py::bool_(v.flag());
    case Value::INT: return py::int_(v.int_value());
    case Value::NUMBER: return py::float_(v.number_value());
    case Value::STRING: return py::str(v.string_value());
    case Value::LIST:
    {
        py::list out;
        for (const Value& item : v.items())
            out.append(to_python(item));
        return out;
    }
    case Value::TUPLE:
    {
        py::tuple out(v.items().size());
        for (size_t i = 0; i < v.items().size(); ++i)
            out[i] = to_python(v.items()[i]);
        return out;
    }
    case Value::DICT:
    {
        py::dict out;
        for (const auto& f : v.fields())
            out[py::str(f.first)] = to_python(f.second);
        return out;
    }
    }
    return py::none();
}

}  // namespace smlibpy
