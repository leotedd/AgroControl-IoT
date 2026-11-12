#pragma once
#include <stdint.h>
#include <stddef.h>
#include <math.h>
#include <string.h>

namespace agro {
enum class LinkState { NoWifi, NoTime, NoApiConfig, AwaitingApi, ApiReady };
inline constexpr LinkState linkState(bool wifi, bool time, bool configured, bool trusted) {
  return !wifi ? LinkState::NoWifi : !time ? LinkState::NoTime :
         !configured ? LinkState::NoApiConfig : !trusted ? LinkState::AwaitingApi : LinkState::ApiReady;
}
inline constexpr bool usableSession(bool connected, bool freshTime, bool trusted,
                                    uint32_t verified, uint32_t current) {
  return connected && freshTime && trusted && verified == current;
}
constexpr uint64_t MaxSafeInteger = 9007199254740991ULL;
inline constexpr bool receiptCounts(size_t sent,uint64_t received,uint64_t duplicate,size_t discarded) {
  return received<=sent && duplicate<=sent && discarded<=sent && received+duplicate+discarded==sent;
}
inline constexpr bool receiptDiscardSequences(const uint32_t* sent,size_t count,const uint32_t* discarded,size_t rejected) {
  if ((!sent && count) || (!discarded && rejected) || rejected>count) return false;
  for (size_t i=0;i<rejected;++i) {
    bool found=false;
    for (size_t j=0;j<count;++j) if (discarded[i]==sent[j]) found=true;
    if (!found) return false;
    for (size_t j=0;j<i;++j) if (discarded[i]==discarded[j]) return false;
  }
  return true;
}
inline constexpr bool safeInteger(double value, uint64_t& out, bool positive = false) {
  if (value!=value || value < (positive ? 1.0 : 0.0) || value > double(MaxSafeInteger)) return false;
  const uint64_t converted=uint64_t(value);
  if (double(converted)!=value) return false;
  out=converted; return true;
}
inline constexpr bool leap(int y) { return y % 4 == 0 && (y % 100 != 0 || y % 400 == 0); }
// Strict Gregorian ISO-8601 UTC, 2026..2099, optional 1..3 fractional digits.
inline constexpr bool parseUtc(const char* s, uint64_t& epochMs) {
  if (!s) return false;
  size_t n = strlen(s);
  if (n != 20 && (n < 22 || n > 24)) return false;
  if (s[4]!='-' || s[7]!='-' || s[10]!='T' || s[13]!=':' || s[16]!=':' || s[n-1]!='Z') return false;
  const int pos[] = {0,1,2,3,5,6,8,9,11,12,14,15,17,18};
  for (int p : pos) if (s[p] < '0' || s[p] > '9') return false;
  auto pair = [s](int p) { return (s[p]-'0')*10+s[p+1]-'0'; };
  int y=pair(0)*100+pair(2), m=pair(5), d=pair(8), h=pair(11), min=pair(14), sec=pair(17);
  const int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  if (y<2026 || y>2099 || m<1 || m>12 || d<1 || d>days[m-1]+(m==2 && leap(y)) || h>23 || min>59 || sec>59) return false;
  uint64_t total=0;
  for (int yr=1970; yr<y; ++yr) total+=leap(yr)?366:365;
  for (int mo=1; mo<m; ++mo) total+=days[mo-1]+(mo==2 && leap(y));
  total+=d-1;
  unsigned fraction=0;
  if (n!=20) {
    if (s[19]!='.') return false;
    for (size_t i=20;i<n-1;++i) {
      if (s[i]<'0' || s[i]>'9') return false;
      fraction=fraction*10+s[i]-'0';
    }
    for (size_t i=n-21;i<3;++i) fraction*=10;
  }
  epochMs=(((total*24+h)*60+min)*60+sec)*1000+fraction;
  return true;
}
inline constexpr uint64_t deadline(uint64_t requestSent, uint64_t expiry, uint64_t server) {
  if (expiry <= server || requestSent > MaxSafeInteger-(expiry-server)) return requestSent;
  return requestSent+expiry-server;
}
inline constexpr bool liveOrder(bool trusted, uint64_t utc, uint64_t mono,
                      uint64_t expiry, uint64_t monoDeadline) {
  return trusted && expiry && utc<expiry && mono<monoDeadline;
}
inline uint32_t crc32(const void* data, size_t size) {
  uint32_t crc=0xffffffffUL;
  const uint8_t* p=static_cast<const uint8_t*>(data);
  for (size_t i=0;i<size;++i) {
    crc^=p[i];
    for (int bit=0;bit<8;++bit) crc=(crc>>1)^(0xedb88320UL & (0UL-(crc&1)));
  }
  return ~crc;
}
class Backoff {
 public:
  uint32_t failure(uint32_t random) {
    const uint32_t result=base_+random%(base_/4+1);
    if (base_<60000) base_=base_>30000?60000:base_*2;
    return result>60000?60000:result;
  }
  void success() { base_=2000; }
 private:
  uint32_t base_=2000;
};
} // namespace agro
