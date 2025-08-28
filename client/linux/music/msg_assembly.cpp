#include<iostream>
#include<QDebug>
#include"./msg_assembly.h"


std::string CMsgAssembly:: assembly(const media::MsgType type, const std::string& serialized_data) {
    std::string msg_header = std::to_string(static_cast<int>(type));

    qInfo() << msg_header;
    return msg_header + ":" + serialized_data;
}
