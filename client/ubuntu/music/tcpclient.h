#ifndef TCPCLIENT_H
#define TCPCLIENT_H

#include <QObject>
#include<QTcpSocket>
#include<QScopedPointer>


class TcpClient : public QObject
{
    Q_OBJECT
public:
    TcpClient();
    ~TcpClient();

    void start();

private:
    QScopedPointer<QTcpSocket> clientSock_;
};

#endif // TCPCLIENT_H
