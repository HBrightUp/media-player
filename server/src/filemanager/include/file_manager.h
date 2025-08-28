#pragma once


class CFileManager{

    public:
        static CFileManager& getInstance();
        ~CFileManager();

        bool init();

    private:
        CFileManager();
        
};