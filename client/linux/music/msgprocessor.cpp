#include<QDebug>
#include<QMutex>
#include "msgprocessor.h"

MsgProcessor::MsgProcessor(QObject *parent)
    : QThread{parent}
{}

void MsgProcessor::run(){
    qInfo() << "start msg processor.";

    this->parent()->o

    while(true) {
        QMutexLocker lock(this->ms)
    }

}
