#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <thread>
#include <mutex>
#include <signal.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/wait.h>
#include <libwebsockets.h>
#include <sqlite3.h>
#include <openssl/evp.h>
#include <ctime>
#include <fstream>
#include <cstring>
#include <sstream>
#include <queue>

// ========== Логирование ==========
class Logger {
private:
    std::ofstream logFile;
    std::mutex logMutex;
    
public:
    Logger() {
        system("mkdir -p ../logs");
        logFile.open("../logs/server.log", std::ios::app);
    }
    
    void log(const std::string& level, const std::string& message) {
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
    
    void error(const std::string& message) {
        log("ERROR", message);
    }
    ~Logger() {
        if (logFile.is_open()) logFile.close();
    }
};

Logger logger;

// ========== База данных ==========
class Database {
private:
    sqlite3* db;
    std::mutex dbMutex;
    
public:
    Database() {
        sqlite3_open("../messages.db", &db);
        const char* createTable = 
            "CREATE TABLE IF NOT EXISTS messages ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "from_user TEXT,"
            "to_user TEXT,"
            "message TEXT,"
            "timestamp INTEGER"
            ");";
        sqlite3_exec(db, createTable, nullptr, nullptr, nullptr);
        logger.log("DB", "Database initialized");
    }
    
    void saveMessage(const std::string& from, const std::string& to, const std::string& msg) {
        std::lock_guard<std::mutex> lock(dbMutex);
        std::string sql = "INSERT INTO messages (from_user, to_user, message, timestamp) VALUES ('" +
                         from + "', '" + to + "', '" + msg + "', " + std::to_string(time(nullptr)) + ");";
        sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr);
    }
    
    std::string getHistory(const std::string& user) {
        std::lock_guard<std::mutex> lock(dbMutex);
        std::string history;
        std::string sql = "SELECT from_user, message FROM messages "
                         "WHERE from_user='" + user + "' OR to_user='" + user + "' "
                         "ORDER BY timestamp DESC LIMIT 20;";
        
        sqlite3_stmt* stmt;
        sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
        
        std::vector<std::string> msgs;
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            std::string msg = std::string((const char*)sqlite3_column_text(stmt, 0)) + ": " +
                             std::string((const char*)sqlite3_column_text(stmt, 1));
            msgs.push_back(msg);
        }
        sqlite3_finalize(stmt);
        
        for (auto it = msgs.rbegin(); it != msgs.rend(); ++it) {
            history += *it + "\n";
        }
        
        return history;
    }
    
    ~Database() {
        sqlite3_close(db);
    }
};

Database db;

// ========== Клиентская структура ==========
struct PerSessionData {
    std::string username;
    bool registered;
    std::queue<std::string> pendingMessages;
};

std::map<struct lws*, PerSessionData> clients;
std::map<std::string, struct lws*> userToWsi;
std::mutex clientsMutex;
volatile sig_atomic_t serverRunning = 1;

// ========== Безопасная отправка ==========
void send_message(struct lws* wsi, const std::string& message) {
    if (!wsi) return;
    
    unsigned char* buf = new unsigned char[LWS_SEND_BUFFER_PRE_PADDING + message.length() + LWS_SEND_BUFFER_POST_PADDING];
    unsigned char* p = buf + LWS_SEND_BUFFER_PRE_PADDING;
    memcpy(p, message.c_str(), message.length());
    lws_write(wsi, p, message.length(), LWS_WRITE_TEXT);
    delete[] buf;
}

// ========== Обработчики сигналов ==========
void signalHandler(int sig) {
    if (sig == SIGTERM || sig == SIGINT) {
        logger.log("SERVER", "Shutting down...");
        serverRunning = 0;
    }
}

// ========== WebSocket колбэк ==========
int callback_messenger(struct lws* wsi, enum lws_callback_reasons reason,
                       void* user, void* in, size_t len) {
    
    PerSessionData* data = (PerSessionData*)user;
    
    switch (reason) {
        case LWS_CALLBACK_PROTOCOL_INIT:
            logger.log("LWS", "Protocol initialized");
            break;
            
        case LWS_CALLBACK_ESTABLISHED: {
            logger.log("CONNECTION", "New client connected");
            // Создаём данные сессии
            if (!data) {
                lws_callback_on_writable(wsi);
            }
            break;
        }
        
        case LWS_CALLBACK_RECEIVE: {
            if (!in || len == 0) break;
            
            std::string message((char*)in, len);
            while (!message.empty() && (message.back() == '\n' || message.back() == '\r')) {
                message.pop_back();
            }
            
            logger.log("RECV", message);
            
            // Получаем или создаём данные сессии
            if (!data) {
                data = (PerSessionData*)lws_wsi_user(wsi);
                if (!data) {
                    logger.error("No session data");
                    break;
                }
            }
            
            // /reg
            if (message.substr(0, 5) == "/reg " || message == "/reg") {
                std::string username = message.length() > 5 ? message.substr(5) : "";
                
                while (!username.empty() && (username.back() == ' ' || username.back() == '\n' || username.back() == '\r')) {
                    username.pop_back();
                }
                
                logger.log("AUTH", "Registering: '" + username + "'");
                
                if (username.empty()) {
                    send_message(wsi, "ERROR: Username cannot be empty\n");
                    break;
                }
                
                bool success = false;
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    if (userToWsi.find(username) == userToWsi.end() && !data->registered) {
                        data->username = username;
                        data->registered = true;
                        userToWsi[username] = wsi;
                        success = true;
                    }
                }
                
                if (success) {
                    logger.log("AUTH", "User '" + username + "' registered");
                    send_message(wsi, "✅ Welcome " + username + "!\n");
                    send_message(wsi, "Commands: /msg <user> <text>, /users, /history, /help\n");
                    
                    std::string history = db.getHistory(username);
                    if (!history.empty()) {
                        send_message(wsi, "📜 History:\n" + history + "\n");
                    }
                } else {
                    send_message(wsi, "ERROR: Username already taken or invalid\n");
                }
            }
            // /msg
            else if (message.substr(0, 5) == "/msg " && data && data->registered) {
                std::string rest = message.substr(5);
                size_t space = rest.find(' ');
                
                if (space == std::string::npos) {
                    send_message(wsi, "ERROR: Usage: /msg <user> <message>\n");
                    break;
                }
                
                std::string recipient = rest.substr(0, space);
                std::string text = rest.substr(space + 1);
                
                if (recipient.empty() || text.empty()) {
                    send_message(wsi, "ERROR: Usage: /msg <user> <message>\n");
                    break;
                }
                
                logger.log("MSG", data->username + " -> " + recipient + ": " + text);
                db.saveMessage(data->username, recipient, text);
                
                bool delivered = false;
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    auto it = userToWsi.find(recipient);
                    if (it != userToWsi.end()) {
                        send_message(it->second, "💬 " + data->username + ": " + text + "\n");
                        delivered = true;
                    }
                }
                
                if (delivered) {
                    send_message(wsi, "✓ Sent to " + recipient + "\n");
                } else {
                    send_message(wsi, "ERROR: User '" + recipient + "' not online\n");
                }
            }
            // /users
            else if (message == "/users") {
                std::string list = "📋 Online users:\n";
                std::lock_guard<std::mutex> lock(clientsMutex);
                for (auto& pair : userToWsi) {
                    list += "  • " + pair.first + "\n";
                }
                if (userToWsi.empty()) list += "  (none)\n";
                send_message(wsi, list);
            }
            // /history
            else if (message == "/history" && data && data->registered) {
                std::string history = db.getHistory(data->username);
                if (history.empty()) history = "No messages\n";
                send_message(wsi, "📜 History:\n" + history + "\n");
            }
            // /help
            else if (message == "/help") {
                send_message(wsi, 
                    "\nCommands:\n"
                    "  /reg <name>  - Register\n"
                    "  /msg <user> <text> - Send message\n"
                    "  /users       - List users\n"
                    "  /history     - Your history\n"
                    "  /quit        - Disconnect\n"
                    "  /help        - This help\n\n");
            }
            // /quit
            else if (message == "/quit") {
                send_message(wsi, "Goodbye!\n");
                return -1;
            }
            else if (!message.empty() && message[0] == '/') {
                send_message(wsi, "Unknown command. Type /help\n");
            }
            
            break;
        }
        
        case LWS_CALLBACK_CLOSED:
        case LWS_CALLBACK_WSI_DESTROY: {
            if (data && data->registered) {
                logger.log("DISCONNECT", "User '" + data->username + "' disconnected");
                std::lock_guard<std::mutex> lock(clientsMutex);
                userToWsi.erase(data->username);
            }
            break;
        }
        
        default:
            break;
    }
    
    return 0;
}

// ========== WebSocket протокол ==========
static struct lws_protocols protocols[] = {
    {
        "messenger",
        callback_messenger,
        sizeof(PerSessionData),
        4096,
    },
    { NULL, NULL, 0, 0 }
};

// ========== Главная функция ==========
int main() {
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);
    
    logger.log("SERVER", "========================================");
    logger.log("SERVER", "Messenger Server v3.0 (Stable)");
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
    
    struct lws_context* context = lws_create_context(&info);
    if (!context) {
        logger.log("ERROR", "Failed to create context");
        return 1;
    }
    
    logger.log("SERVER", "Ready. Connect to ws://localhost:8080");
    logger.log("SERVER", "Press Ctrl+C to stop");
    
    while (serverRunning) {
        lws_service(context, 50);
    }
    
    lws_context_destroy(context);
    logger.log("SERVER", "Stopped");
    return 0;
}