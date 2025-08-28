#include<iostream>
#include"../include/file_manager.h"


CFileManager::CFileManager() {

}

CFileManager::~CFileManager() {

}

CFileManager& CFileManager::getInstance() {
    static CFileManager manager;

    return manager;
}

bool CFileManager::init() {

    return true;
}