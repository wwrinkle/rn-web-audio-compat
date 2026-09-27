#pragma once

// rn-web-audio-compat: small numeric helpers shared by kernels (built-in and extension kernels).

#include <cmath>
#include <limits>

namespace rnwac::util {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;

// JS Math.min/Math.max propagate NaN; std::min/max do not.
inline double jsMin(double a, double b) {
  return (std::isnan(a) || std::isnan(b)) ? std::numeric_limits<double>::quiet_NaN() : (a < b ? a : b);
}
inline double jsMax(double a, double b) {
  return (std::isnan(a) || std::isnan(b)) ? std::numeric_limits<double>::quiet_NaN() : (a > b ? a : b);
}
inline double clampd(double x, double lo, double hi) {
  return jsMin(jsMax(x, lo), hi);
}

inline void zeroOut(float *const *out, int channels, int frames) {
  for (int ch = 0; ch < channels; ++ch) {
    for (int n = 0; n < frames; ++n) {
      out[ch][n] = 0.0f;
    }
  }
}

} // namespace rnwac::util
