#include "Database.h"
#include "Logger.h"
#include "Utils.h"
#include <iostream>

Database::Database() {
    sqlite3_open("../messages.db", &db);
    
    const char* createUsersTable = 
        "CREATE TABLE IF NOT EXISTS users ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "username TEXT UNIQUE NOT NULL,"
        "password TEXT NOT NULL,"
        "created_at INTEGER NOT NULL"
        ");";
    
    const char* createMessagesTable = 
        "CREATE TABLE IF NOT EXISTS messages ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "from_user TEXT NOT NULL,"
        "to_user TEXT NOT NULL,"
        "message TEXT NOT NULL,"
        "timestamp INTEGER NOT NULL"
        ");";
    
    char* errMsg = nullptr;
    sqlite3_exec(db, createUsersTable, nullptr, nullptr, &errMsg);
    sqlite3_exec(db, createMessagesTable, nullptr, nullptr, &errMsg);
    
    if (errMsg) {
        logger.log("DB", "Error: " + std::string(errMsg));
        sqlite3_free(errMsg);
    } else {
        logger.log("DB", "Database initialized");
    }
}

bool Database::registerUser(const std::string& username, const std::string& password) {
    std::lock_guard<std::mutex> lock(dbMutex);
    
    std::string sql = "INSERT INTO users (username, password, created_at) VALUES ('" +
                      username + "', '" + password + "', " + std::to_string(time(nullptr)) + ");";
    
    char* errMsg = nullptr;
    int rc = sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &errMsg);
    
    if (rc != SQLITE_OK) {
        if (errMsg) sqlite3_free(errMsg);
        return false;
    }
    
    logger.log("AUTH", "User registered: " + username);
    return true;
}

bool Database::loginUser(const std::string& username, const std::string& password) {
    std::lock_guard<std::mutex> lock(dbMutex);
    
    std::string sql = "SELECT password FROM users WHERE username='" + username + "';";
    
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
    
    bool success = false;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        std::string dbPassword = (const char*)sqlite3_column_text(stmt, 0);
        if (dbPassword == password) success = true;
    }
    sqlite3_finalize(stmt);
    
    logger.log("AUTH", "Login " + std::string(success ? "success" : "failed") + " for " + username);
    return success;
}

std::vector<std::string> Database::getAllUsers() {
    std::lock_guard<std::mutex> lock(dbMutex);
    std::vector<std::string> users;
    
    std::string sql = "SELECT username FROM users ORDER BY username;";
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
    
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        users.push_back((const char*)sqlite3_column_text(stmt, 0));
    }
    sqlite3_finalize(stmt);
    
    return users;
}

void Database::saveMessage(const std::string& from, const std::string& to, const std::string& msg) {
    std::lock_guard<std::mutex> lock(dbMutex);
    
    std::string escapedMsg = msg;
    size_t pos = 0;
    while ((pos = escapedMsg.find("'", pos)) != std::string::npos) {
        escapedMsg.replace(pos, 1, "''");
        pos += 2;
    }
    
    std::string sql = "INSERT INTO messages (from_user, to_user, message, timestamp) VALUES ('" +
                      from + "', '" + to + "', '" + escapedMsg + "', " +
                      std::to_string(time(nullptr)) + ");";
    
    char* errMsg = nullptr;
    sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &errMsg);
    if (errMsg) sqlite3_free(errMsg);
}

std::string Database::getDialogJSON(const std::string& user1, const std::string& user2) {
    std::lock_guard<std::mutex> lock(dbMutex);
    std::string json = "[";
    
    std::string sql = "SELECT id, from_user, to_user, message, timestamp FROM messages "
                      "WHERE (from_user='" + user1 + "' AND to_user='" + user2 + "') "
                      "OR (from_user='" + user2 + "' AND to_user='" + user1 + "') "
                      "ORDER BY timestamp ASC LIMIT 100;";
    
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
    
    bool first = true;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (!first) json += ",";
        first = false;
        
        int id = sqlite3_column_int(stmt, 0);
        std::string from = (const char*)sqlite3_column_text(stmt, 1);
        std::string to = (const char*)sqlite3_column_text(stmt, 2);
        std::string msg = (const char*)sqlite3_column_text(stmt, 3);
        int timestamp = sqlite3_column_int(stmt, 4);
        
        json += "{";
        json += "\"id\":\"" + std::to_string(id) + "\",";
        json += "\"sender\":\"" + escape_json(from) + "\",";
        json += "\"recipient\":\"" + escape_json(to) + "\",";
        json += "\"text\":\"" + escape_json(msg) + "\",";
        json += "\"timestamp\":" + std::to_string(timestamp) + "000";
        json += "}";
    }
    sqlite3_finalize(stmt);
    json += "]";
    return json;
}

std::string Database::getRecentDialogsJSON(const std::string& currentUser) {
    std::lock_guard<std::mutex> lock(dbMutex);
    std::string json = "[";
    
    std::string sql = 
        "SELECT chat_user, message FROM ("
        "  SELECT CASE WHEN from_user = '" + currentUser + "' THEN to_user ELSE from_user END AS chat_user, "
        "  message, timestamp, "
        "  ROW_NUMBER() OVER (PARTITION BY CASE WHEN from_user = '" + currentUser + "' THEN to_user ELSE from_user END ORDER BY timestamp DESC) as rn "
        "  FROM messages WHERE from_user = '" + currentUser + "' OR to_user = '" + currentUser + "'"
        ") WHERE rn = 1 ORDER BY timestamp DESC;";
    
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
    
    bool first = true;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (!first) json += ",";
        first = false;
        
        std::string chat_user = (const char*)sqlite3_column_text(stmt, 0);
        std::string last_msg = (const char*)sqlite3_column_text(stmt, 1);
        
        json += "{";
        json += "\"username\":\"" + escape_json(chat_user) + "\",";
        json += "\"lastMessage\":\"" + escape_json(last_msg) + "\"";
        json += "}";
    }
    sqlite3_finalize(stmt);
    json += "]";
    return json;
}

Database::~Database() {
    sqlite3_close(db);
}

Database db;