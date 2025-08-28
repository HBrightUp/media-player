#ifndef MSGPROCESSOR_H
#define MSGPROCESSOR_H

#include <QObject>
#include <QThread>

class MsgProcessor : public QThread
{
public:
    explicit MsgProcessor(QObject *parent = nullptr);

    void run() override;
};

#endif // MSGPROCESSOR_H
