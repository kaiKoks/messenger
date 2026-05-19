CXX = g++
CXXFLAGS = -Wall -std=c++17 -pthread
LIBS = -lwebsockets -lsqlite3 -lssl -lcrypto

SRC_DIR = src
BUILD_DIR = build
TARGET = server

SRCS = $(SRC_DIR)/main.cpp \
       $(SRC_DIR)/Logger.cpp \
       $(SRC_DIR)/Database.cpp \
       $(SRC_DIR)/WebSocketHandler.cpp

OBJS = $(SRCS:$(SRC_DIR)/%.cpp=$(BUILD_DIR)/%.o)

all: $(BUILD_DIR) $(TARGET)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(TARGET): $(OBJS)
	$(CXX) $(CXXFLAGS) -o $(TARGET) $(OBJS) $(LIBS)

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -rf $(BUILD_DIR) $(TARGET)

run: $(TARGET)
	./$(TARGET)

.PHONY: all clean run