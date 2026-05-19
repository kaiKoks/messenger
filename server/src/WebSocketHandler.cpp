#include "WebSocketHandler.h"
#include "Database.h"
#include "Logger.h"
#include "Utils.h"
#include <cstring>
#include <new>

std::map<struct lws*, PerSessionData*> clients;
std::map<std::string, struct lws*> userToWsi;
std::mutex clientsMutex;
std::atomic<bool> serverRunning{true};

void send_message(struct lws* wsi, const std::string& message) {
    if (!wsi) return;
    
    PerSessionData* session_data = nullptr;
    {
        std::lock_guard<std::mutex> lock(clientsMutex);
        auto it = clients.find(wsi);
        if (it != clients.end()) session_data = it->second;
    }
    
    if (session_data && session_data->is_initialized) {
        {
            std::lock_guard<std::mutex> q_lock(session_data->queue_mutex);
            session_data->message_queue.push_back(message + "\n");
        }
        lws_callback_on_writable(wsi);
    }
}

void send_json_status(struct lws* wsi, const std::string& type, const std::string& status, const std::string& payload) {
    std::string json = "{\"type\":\"" + type + "\",\"status\":\"" + status + "\"";
    if (!payload.empty()) {
        json += ",\"payload\":" + payload;
    }
    json += "}";
    send_message(wsi, json);
}

int callback_messenger(struct lws* wsi, enum lws_callback_reasons reason, void* user, void* in, size_t len) {
    PerSessionData* data = (PerSessionData*)user;
    
    switch (reason) {
    case LWS_CALLBACK_ESTABLISHED: {
        logger.log("CONNECTION", "New client connected");
        if (data) {
            new (data) PerSessionData();
            data->is_initialized = true;
            data->authenticated = false;
            data->username = "";
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                clients[wsi] = data;
            }
        }
        send_json_status(wsi, "connection", "connected", "\"Welcome to Messenger\"");
        break;
    }
    
    case LWS_CALLBACK_SERVER_WRITEABLE: {
        if (!data) break;
        
        std::string msg_to_send;
        {
            std::lock_guard<std::mutex> lock(data->queue_mutex);
            if (!data->message_queue.empty()) {
                msg_to_send = data->message_queue.front();
                data->message_queue.erase(data->message_queue.begin());
            }
        }
        
        if (!msg_to_send.empty()) {
            unsigned char* buf = new unsigned char[LWS_SEND_BUFFER_PRE_PADDING + msg_to_send.length() + LWS_SEND_BUFFER_POST_PADDING];
            unsigned char* p = buf + LWS_SEND_BUFFER_PRE_PADDING;
            memcpy(p, msg_to_send.c_str(), msg_to_send.length());
            lws_write(wsi, p, msg_to_send.length(), LWS_WRITE_TEXT);
            delete[] buf;
            
            bool has_more = false;
            {
                std::lock_guard<std::mutex> lock(data->queue_mutex);
                has_more = !data->message_queue.empty();
            }
            if (has_more) lws_callback_on_writable(wsi);
        }
        break;
    }
    
    case LWS_CALLBACK_RECEIVE: {
        if (!in || len == 0 || !data) break;
        
        std::string message((char*)in, len);
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r')) message.pop_back();
        if (message.empty()) break;
        
        logger.log("RECV", message);
        
        // ========== РЕГИСТРАЦИЯ ==========
        if (message.find("/register") == 0) {
            std::string rest = message.size() > 9 ? message.substr(9) : "";
            while (!rest.empty() && rest.front() == ' ') rest.erase(0, 1);
            size_t space = rest.find(' ');
            
            if (space == std::string::npos) {
                send_json_status(wsi, "register", "error", "\"Usage: /register <username> <password>\"");
                break;
            }
            
            std::string username = rest.substr(0, space);
            std::string password = rest.substr(space + 1);
            
            while (!username.empty() && (username.back() == ' ' || username.back() == '\n')) username.pop_back();
            while (!password.empty() && (password.back() == ' ' || password.back() == '\n')) password.pop_back();
            
            if (db.registerUser(username, password)) {
                // Отправляем успешный JSON ответ
                std::string response = "{\"type\":\"register\",\"status\":\"success\",\"payload\":\"" + username + "\"}";
                send_message(wsi, response);
                logger.log("REGISTER", "User " + username + " registered successfully");
            } else {
                std::string response = "{\"type\":\"register\",\"status\":\"fail\",\"payload\":\"Username already exists\"}";
                send_message(wsi, response);
                logger.log("REGISTER", "Failed to register " + username);
            }
            break;
        }
        
        // ========== ВХОД ==========
        if (message.find("/login") == 0) {
            std::string rest = message.size() > 6 ? message.substr(6) : "";
            while (!rest.empty() && rest.front() == ' ') rest.erase(0, 1);
            size_t space = rest.find(' ');
            
            if (space == std::string::npos) {
                send_json_status(wsi, "login", "error", "\"Usage: /login <username> <password>\"");
                break;
            }
            
            std::string username = rest.substr(0, space);
            std::string password = rest.substr(space + 1);
            
            while (!username.empty() && (username.back() == ' ' || username.back() == '\n')) username.pop_back();
            while (!password.empty() && (password.back() == ' ' || password.back() == '\n')) password.pop_back();
            
            if (db.loginUser(username, password)) {
                data->username = username;
                data->authenticated = true;
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    userToWsi[username] = wsi;
                }
                
                // Отправляем успешный JSON ответ
                std::string response = "{\"type\":\"login\",\"status\":\"success\",\"payload\":\"" + username + "\"}";
                send_message(wsi, response);
                logger.log("LOGIN", "User " + username + " logged in");
                
                // Отправляем список всех пользователей
                std::vector<std::string> users = db.getAllUsers();
                std::string userList = "[";
                for (size_t i = 0; i < users.size(); i++) {
                    if (users[i] != username) {
                        if (userList.size() > 1) userList += ",";
                        userList += "\"" + escape_json(users[i]) + "\"";
                    }
                }
                userList += "]";
                std::string usersResponse = "{\"type\":\"all_users\",\"status\":\"success\",\"payload\":" + userList + "}";
                send_message(wsi, usersResponse);
                
                // Отправляем список онлайн
                std::string onlineList = "[";
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    bool first = true;
                    for (auto& pair : userToWsi) {
                        if (pair.first != username) {
                            if (!first) onlineList += ",";
                            onlineList += "\"" + escape_json(pair.first) + "\"";
                            first = false;
                        }
                    }
                }
                onlineList += "]";
                std::string onlineResponse = "{\"type\":\"online_users\",\"status\":\"success\",\"payload\":" + onlineList + "}";
                send_message(wsi, onlineResponse);
                
                // Отправляем список диалогов
                std::string dialogsJSON = db.getRecentDialogsJSON(username);
                std::string dialogsResponse = "{\"type\":\"dialogs_list\",\"status\":\"success\",\"payload\":" + dialogsJSON + "}";
                send_message(wsi, dialogsResponse);
                
            } else {
                std::string response = "{\"type\":\"login\",\"status\":\"fail\",\"payload\":\"Invalid credentials\"}";
                send_message(wsi, response);
                logger.log("LOGIN", "Failed login for " + username);
            }
            break;
        }
        
        if (!data->authenticated) {
            send_json_status(wsi, "auth", "error", "\"Please login first\"");
            break;
        }
        
        // ========== ОТПРАВКА СООБЩЕНИЯ ==========
        if (message.find("/msg ") == 0) {
            std::string rest = message.substr(5);
            size_t space = rest.find(' ');
            if (space == std::string::npos) {
                send_json_status(wsi, "msg_status", "error", "\"Usage: /msg <user> <message>\"");
                break;
            }
            
            std::string recipient = rest.substr(0, space);
            std::string text = rest.substr(space + 1);
            
            if (recipient.empty() || text.empty()) {
                send_json_status(wsi, "msg_status", "error", "\"Usage: /msg <user> <message>\"");
                break;
            }
            
            logger.log("MSG", data->username + " -> " + recipient + ": " + text);
            db.saveMessage(data->username, recipient, text);
            
            struct lws* recipient_wsi = nullptr;
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                auto it = userToWsi.find(recipient);
                if (it != userToWsi.end()) recipient_wsi = it->second;
            }
            
            // Формируем JSON для получателя
            std::string msgJson = "{\"type\":\"message\",\"id\":\"" + std::to_string(time(nullptr)) + 
                                  "\",\"sender\":\"" + escape_json(data->username) + 
                                  "\",\"recipient\":\"" + escape_json(recipient) + 
                                  "\",\"text\":\"" + escape_json(text) + 
                                  "\",\"timestamp\":" + std::to_string(time(nullptr)) + "000}";
            
            if (recipient_wsi) {
                send_message(recipient_wsi, msgJson);
                send_json_status(wsi, "msg_status", "delivered", "\"" + recipient + "\"");
                logger.log("MSG", "Message delivered to " + recipient);
            } else {
                send_json_status(wsi, "msg_status", "saved_offline", "\"" + recipient + "\"");
                logger.log("MSG", "User " + recipient + " offline, message saved");
            }
            break;
        }
        
        // ========== СПИСОК ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ==========
        if (message == "/users") {
            std::vector<std::string> users = db.getAllUsers();
            std::string userList = "[";
            for (size_t i = 0; i < users.size(); i++) {
                if (users[i] != data->username) {
                    if (userList.size() > 1) userList += ",";
                    userList += "\"" + escape_json(users[i]) + "\"";
                }
            }
            userList += "]";
            std::string response = "{\"type\":\"all_users\",\"status\":\"success\",\"payload\":" + userList + "}";
            send_message(wsi, response);
            break;
        }
        
        // ========== СПИСОК ОНЛАЙН ==========
        if (message == "/online") {
            std::string onlineList = "[";
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                bool first = true;
                for (auto& pair : userToWsi) {
                    if (pair.first != data->username) {
                        if (!first) onlineList += ",";
                        onlineList += "\"" + escape_json(pair.first) + "\"";
                        first = false;
                    }
                }
            }
            onlineList += "]";
            std::string response = "{\"type\":\"online_users\",\"status\":\"success\",\"payload\":" + onlineList + "}";
            send_message(wsi, response);
            break;
        }
        
        // ========== ИСТОРИЯ ДИАЛОГА ==========
        if (message.find("/dialog ") == 0) {
            std::string recipient = message.substr(8);
            while (!recipient.empty() && recipient.front() == ' ') recipient.erase(0, 1);
            std::string dialogJSON = db.getDialogJSON(data->username, recipient);
            std::string response = "{\"type\":\"dialog_history\",\"recipient\":\"" + escape_json(recipient) + 
                                   "\",\"messages\":" + dialogJSON + "}";
            send_message(wsi, response);
            break;
        }
        
        // ========== СПИСОК ДИАЛОГОВ ==========
        if (message == "/dialogs") {
            std::string recentJSON = db.getRecentDialogsJSON(data->username);
            std::string response = "{\"type\":\"dialogs_list\",\"status\":\"success\",\"payload\":" + recentJSON + "}";
            send_message(wsi, response);
            break;
        }
        
        // ========== ВЫХОД ==========
        if (message == "/quit") {
            send_json_status(wsi, "exit", "goodbye");
            return -1;
        }
        break;
    }
    
    case LWS_CALLBACK_CLOSED:
    case LWS_CALLBACK_WSI_DESTROY: {
        if (data && data->is_initialized) {
            if (data->authenticated && !data->username.empty()) {
                logger.log("DISCONNECT", "User '" + data->username + "' disconnected");
                std::lock_guard<std::mutex> lock(clientsMutex);
                userToWsi.erase(data->username);
            }
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                clients.erase(wsi);
            }
            data->~PerSessionData();
            data->is_initialized = false;
        }
        break;
    }
    
    default:
        break;
    }
    
    return 0;
}