#ifndef TCPCLIENT_H
#define TCPCLIENT_H

#include <QObject>
#include <QTcpSocket>
#include<QByteArray>
#include<QList>
#include<QMutex>
#include<QThread>
#include<QWaitCondition>
#include<QVector>
#include"./msg_assembly.h"
#include"./msgprocessor.h"
#include"./signals_type.h"

class TcpClient : public QThread
{
    Q_OBJECT
public:
    TcpClient(const QString &host, quint16 port);
    ~TcpClient();

public slots:
    void onConnected();
    void onDisconnected();
    void onReadyRead();
    void onErrorOccurred(QTcpSocket::SocketError socketError);

    void writeData(const std::string& buf);

    void run() override;
    void parseMsgHeader(const  QByteArray& data);
    void parseResponse(const QByteArray& msgData, const qint32 offest);
    void parsePlayOnlineRandomRsp(const QByteArray& msgData, const qint32 offest);

signals:
    void login_success();
    void play_online_random_response(const QVector<std::string>& musicList);

private:
    QTcpSocket *socket_;
    QList<QByteArray> msglist_;
    QMutex mutMsgList_;
    QWaitCondition msgCondition_;
};

#endif // TCPCLIENT_H
