#include<QMediaPlayer>
#include<QVideoWidget>
#include<QPushButton>
#include<QSlider>
#include<QLabel>
#include<QVBoxLayout>
#include "video.h"
#include "ui_video.h"



Video::Video(QWidget *parent)
    : QWidget(parent)
    , ui(new Ui::Video)
{
    ui->setupUi(this);
    this->setWindowTitle("Movie Theater");



}

Video::~Video()
{
    delete ui;
}

