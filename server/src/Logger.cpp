#include "Logger.h"
#include <sys/stat.h>

Logger::Logger() {
    mkdir("../logs");
    logFile.open("../logs/server.log", std::ios::app);
}

void Logger::log(const std::string& level, const std::string& message) {
    std::lock_guard<std::mutex> lock(logMutex);
    time_t now = time(nullptr);
    char timestamp[64];
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", localtime(&now));
    
    std::string formatted = std::string(timestamp) + " [" + level + "] " + message;
    
    if (logFile.is_open()) {
        logFile << formatted << std::endl;
        logFile.flush();
    }
    std::cout << formatted << std::endl;
}

Logger::~Logger() {
    if (logFile.is_open()) logFile.close();
}

Logger logger;