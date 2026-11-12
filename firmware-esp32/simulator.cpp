#include "AgroControl/Control.h"
#include <iostream>
#include <string>
using namespace agro;
void event(Event e, uint32_t now) { std::cout << "event," << now << ',' << int(e) << '\n'; }
int main() {
  Controller controller(Config(), event);
  controller.begin(0);
  controller.setMode(Mode::Automatic,0);
  ReconnectSchedule wifi;
  uint64_t id = 1;
  std::cout << "Input: uptime_ms humidity_pct|-1 wifi_0_or_1 action\n"
               "Actions: tick auto manual on off clear fault; monotonic virtual time, no real sleeps\n";
  uint32_t now; float humidity; int online; std::string action;
  while (std::cin >> now >> humidity >> online >> action) {
    Reading r; r.valid = humidity >= 0 && humidity <= 100; r.percent = humidity;
    controller.sample(r,now);
    if (action == "auto") controller.setMode(Mode::Automatic,now);
    else if (action == "manual") controller.setMode(Mode::Manual,now);
    else if (action == "clear") controller.clearFault(now);
    else if (action == "fault") controller.criticalFault(now);
    else if (action == "on" || action == "off") {
      Command cmd; cmd.id = id++; cmd.authorized = true;
      cmd.action = action == "on" ? Action::On : Action::Off;
      std::cout << "command_result=" << int(controller.command(cmd,now,0)) << '\n';
    }
    controller.tick(now);
    const bool reconnect = wifi.due(now,online != 0);
    std::cout << "state," << now << ",humidity=" << humidity << ",wifi=" << online
      << ",retry=" << reconnect << ",pump=" << controller.pump()
      << ",lock=" << controller.locked() << '\n';
  }
  return std::cin.eof() ? 0 : 1;
}
