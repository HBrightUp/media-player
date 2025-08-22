#include "player.h"

#include <QApplication>
#include<QFontDatabase>
#include<QDebug>

#include"uimanage.h"


int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    UiManage ui;
    ui.start();

    return a.exec();
}
