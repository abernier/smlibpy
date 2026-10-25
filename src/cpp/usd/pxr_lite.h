// SPDX-License-Identifier: Apache-2.0
//
// The few OpenUSD types that the BrepArray conversion of NVIDIA's usd-brep uses, without OpenUSD
// (smlibpy reads and writes the .usda text itself, usd.cpp): arrays, small vectors and ranges,
// tokens, paths, printf-style strings, the token-set macros and diagnostics; for the OCCT .brep bridge
// (src/cpp/occt) also ranges in 2 and 3 dimensions, 4 x 4 matrices (OpenUSD's row vectors: p' = p M,
// the translation in the last row) and spans. Same names and the parts of their interfaces the copied
// code calls, with OpenUSD's semantics, so that it compiles and computes as it is.

#pragma once

#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cfloat>
#include <functional>
#include <string>
#include <type_traits>
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
    static constexpr size_t dimension = N;
    using ScalarType = S;
    GfVecN() = default;
    explicit GfVecN(S s) { v.fill(s); }
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
    double GetLengthSq() const { double s = 0; for (int i = 0; i < N; ++i) s += double(v[i]) * double(v[i]); return s; }
    // (the dot product, as OpenUSD's operator*)
    double operator*(const GfVecN& o) const { double s = 0; for (int i = 0; i < N; ++i) s += double(v[i]) * double(o.v[i]); return s; }
    friend GfVecN operator*(double s, const GfVecN& a) { return a * s; }
    // (as OpenUSD: the length before; a vector shorter than eps is divided by eps)
    double Normalize(double eps = 1e-10)
    {
        const double l = GetLength();
        const double d = l > eps ? l : eps;
        for (int i = 0; i < N; ++i)
            v[i] = static_cast<S>(v[i] / d);
        return l;
    }
    GfVecN GetNormalized(double eps = 1e-10) const { GfVecN r = *this; r.Normalize(eps); return r; }
    static GfVecN XAxis() { GfVecN r; r.v[0] = 1; return r; }
    static GfVecN YAxis() { GfVecN r; r.v[1] = 1; return r; }
    static GfVecN ZAxis() { static_assert(N > 2, "no z axis"); GfVecN r; r.v[2] = 1; return r; }
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
    GfRange3f& UnionWith(const GfRange3f& o) { *this = Union(*this, o); return *this; }
};
// (empty: from FLT_MAX to -FLT_MAX, as OpenUSD's ranges)
class GfRange1d
{
public:
    double min_ = FLT_MAX, max_ = -FLT_MAX;
    GfRange1d() = default;
    GfRange1d(double a, double b) : min_(a), max_(b) {}
    double GetMin() const { return min_; }
    double GetMax() const { return max_; }
    void SetMin(double a) { min_ = a; }
    void SetMax(double a) { max_ = a; }
    void SetEmpty() { min_ = FLT_MAX, max_ = -FLT_MAX; }
    bool IsEmpty() const { return min_ > max_; }
    double GetSize() const { return max_ - min_; }
    double GetMidpoint() const { return 0.5 * min_ + 0.5 * max_; }
    bool Contains(double p) const { return !(p < min_ || p > max_); }
    GfRange1d& UnionWith(double p) { min_ = std::fmin(min_, p), max_ = std::fmax(max_, p); return *this; }
    GfRange1d& UnionWith(const GfRange1d& r) { min_ = std::fmin(min_, r.min_), max_ = std::fmax(max_, r.max_); return *this; }
    bool operator==(const GfRange1d& o) const { return min_ == o.min_ && max_ == o.max_; }
    bool operator!=(const GfRange1d& o) const { return !(*this == o); }
};

template <class S, int N>
inline double GfDot(const GfVecN<S, N>& a, const GfVecN<S, N>& b) { return a * b; }
template <class S>
inline GfVecN<S, 3> GfCross(const GfVecN<S, 3>& a, const GfVecN<S, 3>& b)
{
    return GfVecN<S, 3>(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
}
template <class S, int N>
inline GfVecN<S, N> GfGetNormalized(const GfVecN<S, N>& a, double eps = 1e-10) { return a.GetNormalized(eps); }
template <class S, int N>
inline double GfGetLength(const GfVecN<S, N>& a) { return a.GetLength(); }

// GfRange2d, GfRange3d: boxes of points (empty: from FLT_MAX to -FLT_MAX, as OpenUSD's)
template <class V, int N>
class GfRangeN
{
public:
    V min_{FLT_MAX}, max_{-FLT_MAX};
    GfRangeN() = default;
    GfRangeN(const V& a, const V& b) : min_(a), max_(b) {}
    const V& GetMin() const { return min_; }
    const V& GetMax() const { return max_; }
    void SetMin(const V& a) { min_ = a; }
    void SetMax(const V& a) { max_ = a; }
    void SetEmpty() { min_ = V(FLT_MAX), max_ = V(-FLT_MAX); }
    bool IsEmpty() const { for (int i = 0; i < N; ++i) if (min_[i] > max_[i]) return true; return false; }
    V GetSize() const { return max_ - min_; }
    V GetMidpoint() const { return min_ * 0.5 + max_ * 0.5; }
    bool Contains(const V& p) const { for (int i = 0; i < N; ++i) if (p[i] < min_[i] || p[i] > max_[i]) return false; return true; }
    GfRangeN& UnionWith(const V& p)
    {
        for (int i = 0; i < N; ++i)
            min_[i] = std::fmin(min_[i], p[i]), max_[i] = std::fmax(max_[i], p[i]);
        return *this;
    }
    GfRangeN& UnionWith(const GfRangeN& r)
    {
        for (int i = 0; i < N; ++i)
            min_[i] = std::fmin(min_[i], r.min_[i]), max_[i] = std::fmax(max_[i], r.max_[i]);
        return *this;
    }
    static GfRangeN GetUnion(const GfRangeN& a, const GfRangeN& b) { GfRangeN r = a; r.UnionWith(b); return r; }
    bool operator==(const GfRangeN& o) const { return min_ == o.min_ && max_ == o.max_; }
    bool operator!=(const GfRangeN& o) const { return !(*this == o); }
};
using GfRange2d = GfRangeN<GfVec2d, 2>;
using GfRange3d = GfRangeN<GfVec3d, 3>;

// A 4 x 4 matrix as OpenUSD's: points are row vectors (p' = p M), the translation in the last row.
class GfMatrix4d
{
public:
    double m[4][4];
    GfMatrix4d() { SetIdentity(); }
    explicit GfMatrix4d(double s) { SetDiagonal(s); }
    GfMatrix4d& SetDiagonal(double s)
    {
        for (int r = 0; r < 4; ++r)
            for (int c = 0; c < 4; ++c)
                m[r][c] = r == c ? s : 0.0;
        return *this;
    }
    GfMatrix4d& SetIdentity() { return SetDiagonal(1.0); }
    double* operator[](int r) { return m[r]; }
    const double* operator[](int r) const { return m[r]; }
    GfMatrix4d operator*(const GfMatrix4d& o) const
    {
        GfMatrix4d R(0.0);
        for (int i = 0; i < 4; ++i)
            for (int j = 0; j < 4; ++j)
            {
                double s = 0;
                for (int k = 0; k < 4; ++k)
                    s += m[i][k] * o.m[k][j];
                R.m[i][j] = s;
            }
        return R;
    }
    GfMatrix4d& operator*=(const GfMatrix4d& o) { return *this = *this * o; }
    bool operator==(const GfMatrix4d& o) const
    {
        for (int r = 0; r < 4; ++r)
            for (int c = 0; c < 4; ++c)
                if (m[r][c] != o.m[r][c])
                    return false;
        return true;
    }
    bool operator!=(const GfMatrix4d& o) const { return !(*this == o); }
    // (a point: with the projective divide, as OpenUSD's Transform)
    GfVec3d Transform(const GfVec3d& p) const
    {
        double o[4];
        for (int c = 0; c < 4; ++c)
            o[c] = p[0] * m[0][c] + p[1] * m[1][c] + p[2] * m[2][c] + m[3][c];
        return GfVec3d(o[0] / o[3], o[1] / o[3], o[2] / o[3]);
    }
    GfVec3d TransformAffine(const GfVec3d& p) const
    {
        GfVec3d r;
        for (int c = 0; c < 3; ++c)
            r[c] = p[0] * m[0][c] + p[1] * m[1][c] + p[2] * m[2][c] + m[3][c];
        return r;
    }
    GfVec3d TransformDir(const GfVec3d& d) const
    {
        GfVec3d r;
        for (int c = 0; c < 3; ++c)
            r[c] = d[0] * m[0][c] + d[1] * m[1][c] + d[2] * m[2][c];
        return r;
    }
    GfMatrix4d GetTranspose() const
    {
        GfMatrix4d R;
        for (int r = 0; r < 4; ++r)
            for (int c = 0; c < 4; ++c)
                R.m[r][c] = m[c][r];
        return R;
    }
    GfVec3d ExtractTranslation() const { return GfVec3d(m[3][0], m[3][1], m[3][2]); }
    double GetDeterminant() const
    {
        // (by cofactors of the first row)
        auto minor3 = [this](int skip_c) {
            int cs[3], n = 0;
            for (int c = 0; c < 4; ++c)
                if (c != skip_c)
                    cs[n++] = c;
            const double(&a)[4][4] = m;
            return a[1][cs[0]] * (a[2][cs[1]] * a[3][cs[2]] - a[2][cs[2]] * a[3][cs[1]]) -
                   a[1][cs[1]] * (a[2][cs[0]] * a[3][cs[2]] - a[2][cs[2]] * a[3][cs[0]]) +
                   a[1][cs[2]] * (a[2][cs[0]] * a[3][cs[1]] - a[2][cs[1]] * a[3][cs[0]]);
        };
        return m[0][0] * minor3(0) - m[0][1] * minor3(1) + m[0][2] * minor3(2) - m[0][3] * minor3(3);
    }
    // (Gauss-Jordan with partial pivoting; det: the determinant; a singular one gives a scale by
    // FLT_MAX, as OpenUSD's)
    GfMatrix4d GetInverse(double* det = nullptr, double eps = 0) const
    {
        const double d = GetDeterminant();
        if (det)
            *det = d;
        if (!(std::fabs(d) > eps))
        {
            GfMatrix4d R;
            R.m[0][0] = R.m[1][1] = R.m[2][2] = FLT_MAX;
            return R;
        }
        double a[4][8];
        for (int r = 0; r < 4; ++r)
            for (int c = 0; c < 8; ++c)
                a[r][c] = c < 4 ? m[r][c] : (c - 4 == r ? 1.0 : 0.0);
        for (int c = 0; c < 4; ++c)
        {
            int p = c;
            for (int r = c + 1; r < 4; ++r)
                if (std::fabs(a[r][c]) > std::fabs(a[p][c]))
                    p = r;
            for (int k = 0; k < 8; ++k)
                std::swap(a[c][k], a[p][k]);
            const double pivot = a[c][c];
            for (int k = 0; k < 8; ++k)
                a[c][k] /= pivot;
            for (int r = 0; r < 4; ++r)
                if (r != c)
                {
                    const double f = a[r][c];
                    for (int k = 0; k < 8; ++k)
                        a[r][k] -= f * a[c][k];
                }
        }
        GfMatrix4d R;
        for (int r = 0; r < 4; ++r)
            for (int c = 0; c < 4; ++c)
                R.m[r][c] = a[r][c + 4];
        return R;
    }
};

// A view of contiguous elements, as OpenUSD's TfSpan (std::span of C++20)
template <class T>
class TfSpan
{
public:
    using element_type = T;
    using value_type = std::remove_cv_t<T>;
    using size_type = size_t;
    using difference_type = std::ptrdiff_t;
    TfSpan() = default;
    TfSpan(T* p, size_t n) : p_(p), n_(n) {}
    template <class C, class = decltype(std::declval<C&>().data())>
    TfSpan(C& c) : p_(c.data()), n_(c.size()) {}
    T* data() const { return p_; }
    size_t size() const { return n_; }
    bool empty() const { return n_ == 0; }
    T& operator[](size_t i) const { return p_[i]; }
    T* begin() const { return p_; }
    T* end() const { return p_ + n_; }
    T& front() const { return p_[0]; }
    T& back() const { return p_[n_ - 1]; }
    TfSpan subspan(difference_type off, difference_type count = -1) const
    {
        return TfSpan(p_ + off, count < 0 ? n_ - static_cast<size_t>(off) : static_cast<size_t>(count));
    }

private:
    T* p_ = nullptr;
    size_t n_ = 0;
};
template <class C>
inline TfSpan<const typename C::value_type> TfMakeConstSpan(const C& c) { return TfSpan<const typename C::value_type>(c.data(), c.size()); }
template <class C>
inline TfSpan<typename C::value_type> TfMakeSpan(C& c) { return TfSpan<typename C::value_type>(c.data(), c.size()); }

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
    struct HashFunctor
    {
        size_t operator()(const TfToken& t) const { return std::hash<std::string>()(t.s_); }
    };

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
