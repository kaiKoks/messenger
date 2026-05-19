#include <iostream>
#include <signal.h>
#include <cstring>
#include <libwebsockets.h>

#include "Logger.h"
#include "Database.h"
#include "WebSocketHandler.h"
#include "Protocols.h"

void signalHandler(int sig) {
    if (sig == SIGINT || sig == SIGTERM) {
        logger.log("SERVER", "Shutting down...");
        serverRunning = false;
    }
}

int main() {
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);
    signal(SIGPIPE, SIG_IGN);
    
    logger.log("SERVER", "========================================");
    logger.log("SERVER", "Messenger Server");
    logger.log("SERVER", "========================================");
    logger.log("SERVER", "Starting on port 8080");
    logger.log("SERVER", "PID: " + std::to_string(getpid()));
    
    struct lws_context_creation_info info;
    memset(&info, 0, sizeof(info));
    
    info.port = 8080;
    info.protocols = protocols;
    info.gid = -1;
    info.uid = -1;
    info.options = 0;
    info.timeout_secs = 5;
    
    struct lws_context* context = lws_create_context(&info);
    if (!context) {
        logger.log("ERROR", "Failed to create context. Port 8080 might be in use.");
        logger.log("ERROR", "Try: sudo fuser -k 8080/tcp");
        return 1;
    }
    
    logger.log("SERVER", "Ready. Connect to ws://localhost:8080");
    
    while (serverRunning) {
        lws_service(context, 100);
    }
    
    logger.log("SERVER", "Cleaning up...");
    lws_context_destroy(context);
    logger.log("SERVER", "Server stopped");
    return 0;
}