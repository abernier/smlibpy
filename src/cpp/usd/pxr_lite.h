// SPDX-License-Identifier: Apache-2.0
//
// The few OpenUSD types that the BrepArray conversion of NVIDIA's usd-brep uses, without OpenUSD
// (smlibpy reads and writes the .usda text itself, usd.cpp): arrays, small vectors and ranges,
// tokens, paths, printf-style strings, the token-set macros and diagnostics. Same names and the
// parts of their interfaces the copied code calls, so that it compiles as it is.

#pragma once

#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#define PXR_NAMESPACE_OPEN_SCOPE namespace pxr {
#define PXR_NAMESPACE_CLOSE_SCOPE }
#define PXR_NAMESPACE_USING_DIRECTIVE using namespace pxr;

namespace pxr {

template <class T>
class VtArray : public std::vector<T>
{
public:
    using std::vector<T>::vector;
    VtArray() = default;
    VtArray(const std::vector<T>& v) : std::vector<T>(v) {}
    const T* cdata() const { return this->data(); }
};
using VtIntArray = VtArray<int>;
using VtUIntArray = VtArray<unsigned int>;
using VtDoubleArray = VtArray<double>;

template <class S, int N>
class GfVecN
{
public:
    std::array<S, N> v{};
    GfVecN() = default;
    template <class... A, class = std::enable_if_t<sizeof...(A) == N>>
    GfVecN(A... a) : v{static_cast<S>(a)...} {}
    template <class S2>
    GfVecN(const GfVecN<S2, N>& o) { for (int i = 0; i < N; ++i) v[i] = static_cast<S>(o.v[i]); }
    S& operator[](size_t i) { return v[i]; }
    const S& operator[](size_t i) const { return v[i]; }
    bool operator==(const GfVecN& o) const { return v == o.v; }
    bool operator!=(const GfVecN& o) const { return v != o.v; }
    const S* data() const { return v.data(); }
    S* data() { return v.data(); }
    GfVecN operator+(const GfVecN& o) const { GfVecN r; for (int i = 0; i < N; ++i) r.v[i] = v[i] + o.v[i]; return r; }
    GfVecN operator-(const GfVecN& o) const { GfVecN r; for (int i = 0; i < N; ++i) r.v[i] = v[i] - o.v[i]; return r; }
    GfVecN operator*(double s) const { GfVecN r; for (int i = 0; i < N; ++i) r.v[i] = static_cast<S>(v[i] * s); return r; }
    GfVecN operator/(double s) const { GfVecN r; for (int i = 0; i < N; ++i) r.v[i] = static_cast<S>(v[i] / s); return r; }
    GfVecN& operator+=(const GfVecN& o) { for (int i = 0; i < N; ++i) v[i] += o.v[i]; return *this; }
    GfVecN& operator-=(const GfVecN& o) { for (int i = 0; i < N; ++i) v[i] -= o.v[i]; return *this; }
    GfVecN& operator*=(double s) { for (int i = 0; i < N; ++i) v[i] = static_cast<S>(v[i] * s); return *this; }
    GfVecN& operator/=(double s) { for (int i = 0; i < N; ++i) v[i] = static_cast<S>(v[i] / s); return *this; }
    GfVecN operator-() const { GfVecN r; for (int i = 0; i < N; ++i) r.v[i] = -v[i]; return r; }
    double GetLength() const { double s = 0; for (int i = 0; i < N; ++i) s += double(v[i]) * double(v[i]); return std::sqrt(s); }
};
using GfVec2d = GfVecN<double, 2>;
using GfVec3d = GfVecN<double, 3>;
using GfVec4d = GfVecN<double, 4>;
using GfVec3f = GfVecN<float, 3>;
using GfVec2i = GfVecN<int, 2>;

class GfRange3f
{
public:
    GfVec3f min_{1e30f, 1e30f, 1e30f}, max_{-1e30f, -1e30f, -1e30f};
    GfRange3f() = default;
    GfRange3f(const GfVec3f& a, const GfVec3f& b) : min_(a), max_(b) {}
    const GfVec3f& GetMin() const { return min_; }
    const GfVec3f& GetMax() const { return max_; }
    bool IsEmpty() const { return min_[0] > max_[0] || min_[1] > max_[1] || min_[2] > max_[2]; }
    static GfRange3f Union(const GfRange3f& a, const GfRange3f& b)
    {
        GfRange3f r;
        for (int i = 0; i < 3; ++i)
            r.min_[i] = std::fmin(a.min_[i], b.min_[i]), r.max_[i] = std::fmax(a.max_[i], b.max_[i]);
        return r;
    }
};
class GfRange1d
{
public:
    double min_ = 1e300, max_ = -1e300;
    GfRange1d() = default;
    GfRange1d(double a, double b) : min_(a), max_(b) {}
    double GetMin() const { return min_; }
    double GetMax() const { return max_; }
};

class TfToken
{
public:
    TfToken() = default;
    TfToken(const char* s) : s_(s ? s : "") {}
    TfToken(std::string s) : s_(std::move(s)) {}
    const std::string& GetString() const { return s_; }
    const char* GetText() const { return s_.c_str(); }
    bool IsEmpty() const { return s_.empty(); }
    bool operator==(const TfToken& o) const { return s_ == o.s_; }
    bool operator!=(const TfToken& o) const { return s_ != o.s_; }
    bool operator<(const TfToken& o) const { return s_ < o.s_; }

private:
    std::string s_;
};
using TfTokenVector = std::vector<TfToken>;

class SdfPath
{
public:
    SdfPath() = default;
    explicit SdfPath(std::string s) : s_(std::move(s)) {}
    static const SdfPath& EmptyPath() { static const SdfPath empty; return empty; }
    const std::string& GetString() const { return s_; }
    const char* GetText() const { return s_.c_str(); }
    bool IsEmpty() const { return s_.empty(); }
    bool operator==(const SdfPath& o) const { return s_ == o.s_; }
    bool operator!=(const SdfPath& o) const { return s_ != o.s_; }
    bool operator<(const SdfPath& o) const { return s_ < o.s_; }

private:
    std::string s_;
};
using SdfPathVector = std::vector<SdfPath>;

inline std::string TfStringPrintf(const char* format, ...)
{
    va_list args, copy;
    va_start(args, format);
    va_copy(copy, args);
    const int n = std::vsnprintf(nullptr, 0, format, copy);
    va_end(copy);
    std::string out(n > 0 ? static_cast<size_t>(n) : 0, '\0');
    if (n > 0)
        std::vsnprintf(out.data(), static_cast<size_t>(n) + 1, format, args);
    va_end(args);
    return out;
}

// What went wrong in a conversion (USDBREP_ERROR, TF_RUNTIME_ERROR), for the error that reports it.
std::string& usd_diagnostics();
inline void usd_diagnose(const std::string& message)
{
    std::string& d = usd_diagnostics();
    if (d.size() < 4000)
        d += (d.empty() ? "" : "; ") + message;
}

}  // namespace pxr

#define TF_RUNTIME_ERROR(...) ::pxr::usd_diagnose(::pxr::TfStringPrintf(__VA_ARGS__))
#define TF_CODING_ERROR(...) ::pxr::usd_diagnose(::pxr::TfStringPrintf(__VA_ARGS__))
#define TF_WARN(...) ((void)0)

// Token sets, as TF_DECLARE_PUBLIC_TOKENS(name, export, ((member, "value")) ...) declares them:
// a struct with one token per member, reached as name->member.
#define SMLIBPY_TOKEN_MEMBER(name, value) ::pxr::TfToken name{value};
#define SMLIBPY_TOKENS_A(x) SMLIBPY_TOKEN_MEMBER x SMLIBPY_TOKENS_B
#define SMLIBPY_TOKENS_B(x) SMLIBPY_TOKEN_MEMBER x SMLIBPY_TOKENS_A
#define SMLIBPY_TOKENS_A_END
#define SMLIBPY_TOKENS_B_END
#define SMLIBPY_TOKENS_CAT(a, b) SMLIBPY_TOKENS_CAT_(a, b)
#define SMLIBPY_TOKENS_CAT_(a, b) a##b
#define SMLIBPY_TOKENS_EACH(seq) SMLIBPY_TOKENS_CAT(SMLIBPY_TOKENS_A seq, _END)
#define TF_DECLARE_PUBLIC_TOKENS(name, exportMacro, seq)                                                               \
    struct name##_StaticTokenType                                                                                      \
    {                                                                                                                  \
        SMLIBPY_TOKENS_EACH(seq)                                                                                       \
    };                                                                                                                 \
    inline const name##_StaticTokenType name##_storage{};                                                             \
    inline const name##_StaticTokenType* const name = &name##_storage;
#define TF_DEFINE_PUBLIC_TOKENS(name, seq)
