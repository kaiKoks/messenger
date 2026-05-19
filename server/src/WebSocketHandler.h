#ifndef WEBSOCKET_HANDLER_H
#define WEBSOCKET_HANDLER_H

#include <libwebsockets.h>
#include <string>
#include <map>
#include <mutex>
#include <vector>
#include <atomic>

struct PerSessionData {
    bool is_initialized;
    std::string username;
    bool authenticated;
    std::vector<std::string> message_queue;
    std::mutex queue_mutex;
};

extern std::map<struct lws*, PerSessionData*> clients;
extern std::map<std::string, struct lws*> userToWsi;
extern std::mutex clientsMutex;
extern std::atomic<bool> serverRunning;

void send_message(struct lws* wsi, const std::string& message);
void send_json_status(struct lws* wsi, const std::string& type, const std::string& status, const std::string& payload = "");
int callback_messenger(struct lws* wsi, enum lws_callback_reasons reason, void* user, void* in, size_t len);

#endif