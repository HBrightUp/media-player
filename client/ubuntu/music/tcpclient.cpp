#include "tcpclient.h"
#include<QDebug>

TcpClient::TcpClient() {
   clientSock_.reset(new QTcpSocket);

    clientSock_.get()->connectToHost("0.0.0.0", 1234);

}

TcpClient::~TcpClient() {
    qInfo() << "tcp client destructor";
}


void TcpClient::start() {

    clientSock_.get()->write("good day");

}
