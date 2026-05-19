#ifndef PROTOCOLS_H
#define PROTOCOLS_H

#include <libwebsockets.h>
#include "WebSocketHandler.h"

static struct lws_protocols protocols[] = {
    {"messenger", callback_messenger, sizeof(PerSessionData), 4096, 0, nullptr},
    {nullptr, nullptr, 0, 0, 0, nullptr}
};

#endif