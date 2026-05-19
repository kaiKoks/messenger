#ifndef LOGGER_H
#define LOGGER_H

#include <iostream>
#include <fstream>
#include <mutex>
#include <string>
#include <ctime>
#include <cstring>

class Logger {
private:
    std::ofstream logFile;
    std::mutex logMutex;
    
public:
    Logger();
    void log(const std::string& level, const std::string& message);
    ~Logger();
};

extern Logger logger;

#endif