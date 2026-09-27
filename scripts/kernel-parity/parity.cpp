// Runs the registered C++ kernels (rnwac::runKernel) on reference data written by writeRefs.ts (from Jest tests)
// and compares sample by sample. Usage: parity <ref-dir>. Exit code 1 if any case exceeds tolerance.

#include <audioapi/dsp/rnwac/Kernels.h>

#include <cmath>
#include <cstdio>
#include <dirent.h>
#include <fstream>
#include <string>
#include <vector>

static bool runFile(const std::string &path, double tol, double *worstOut) {
  std::ifstream f(path);
  std::string name;
  int id, isSource, channels, frames, blocks, nparams;
  double t0, dt;
  f >> name >> id >> isSource >> channels >> frames >> blocks >> t0 >> dt >> nparams;
  std::vector<double> params(nparams);
  for (int i = 0; i < nparams; ++i) f >> params[i];
  rnwac::KernelState state;
  double worst = 0.0;
  int worstBlock = -1, worstCh = -1, worstN = -1;
  double gotAtWorst = 0, wantAtWorst = 0;
  for (int b = 0; b < blocks; ++b) {
    std::vector<std::vector<float>> in(channels, std::vector<float>(frames));
    std::vector<std::vector<float>> want(channels, std::vector<float>(frames));
    std::vector<std::vector<float>> got(channels, std::vector<float>(frames, 0.0f));
    if (!isSource) {
      for (int ch = 0; ch < channels; ++ch)
        for (int n = 0; n < frames; ++n) f >> in[ch][n];
    }
    for (int ch = 0; ch < channels; ++ch)
      for (int n = 0; n < frames; ++n) f >> want[ch][n];
    const float *inPtrs[2] = {in[0].data(), in[1].data()};
    float *outPtrs[2] = {got[0].data(), got[1].data()};
    // Kernels index out[ch][-1] only for n>0, so a plain zeroed vector is safe.
    rnwac::runKernel(id, isSource ? nullptr : inPtrs, outPtrs, channels, frames, params.data(), state, 48000.0, t0 + b * dt);
    for (int ch = 0; ch < channels; ++ch) {
      for (int n = 0; n < frames; ++n) {
        double d = std::fabs(static_cast<double>(got[ch][n]) - static_cast<double>(want[ch][n]));
        if (std::isnan(d)) d = 1e9;
        if (d > worst) {
          worst = d;
          worstBlock = b;
          worstCh = ch;
          worstN = n;
          gotAtWorst = got[ch][n];
          wantAtWorst = want[ch][n];
        }
      }
    }
  }
  *worstOut = worst;
  const bool ok = worst <= tol;
  std::printf("%-18s %s  max|diff|=%.3g", name.c_str(), ok ? "PASS" : "FAIL", worst);
  if (!ok) std::printf("  (block %d ch %d n %d: got %.9g want %.9g)", worstBlock, worstCh, worstN, gotAtWorst, wantAtWorst);
  std::printf("\n");
  return ok;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: parity <ref-dir>\n");
    return 2;
  }
  DIR *dir = opendir(argv[1]);
  if (!dir) return 2;
  std::vector<std::string> files;
  while (dirent *e = readdir(dir)) {
    std::string n = e->d_name;
    if (n.size() > 4 && n.substr(n.size() - 4) == ".txt") files.push_back(std::string(argv[1]) + "/" + n);
  }
  closedir(dir);
  bool all = true;
  for (const auto &file : files) {
    double worst = 0;
    all = runFile(file, 2e-6, &worst) && all;
  }
  std::printf(all ? "ALL PASS\n" : "SOME FAILED\n");
  return all ? 0 : 1;
}
