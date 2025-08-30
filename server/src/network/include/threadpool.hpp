#pragma once
#include<iostream>
#include<thread>
#include<vector>
#include<mutex>
#include<condition_variable>
#include<queue>
#include<format>
#include"../../logger/include/log.h"


const int MAX_THREADS = 1000;

template<class T>
class CThreadPool {

    public:
        CThreadPool(int nums = 3);
        ~CThreadPool();
        std::queue<T*> tasks_queue;
        bool append(T* request);
    private:
        static void* worker(void *arg);
        void run();


    private:
        std::vector<std::thread> work_threads;
        std::mutex queue_mutex;
        std::condition_variable condition;
        bool stop;

};

template<class T>
CThreadPool<T>::CThreadPool(int nums):stop(false) {
    if (nums <= 0 || nums > MAX_THREADS) {
        throw std::exception();
    }

    for(int i = 0; i < nums; ++i) {
        work_threads.emplace_back(worker, this);
    }
}

template<class T>
CThreadPool<T>::~CThreadPool() {
    std::unique_lock<std::mutex> lck(queue_mutex);
    stop = true;

    condition.notify_all();
    for(auto &ww : work_threads) {
        ww.join();
    }
}

template<class T> 
bool CThreadPool<T>::append(T* request) {
    queue_mutex.lock();
    tasks_queue.push(request);
    queue_mutex.unlock();
    condition.notify_one();

    return true;
}

template<class T>
 void*  CThreadPool<T>::worker(void *arg) {
    CThreadPool* pool = (CThreadPool*)arg;
    pool->run();

    return pool;
 }

template<class T> 
void CThreadPool<T>::run() {

    while(!stop) {
        std::unique_lock<std::mutex> lck(this->queue_mutex);
        this->condition.wait(lck, [this] {
            return !this->tasks_queue.empty() || stop;
        });

        if (this->tasks_queue.empty()) {
             continue;
        } 

        //Logger::getInstance().print(std::format(" Number of current task:  {}", this->tasks_queue.size()));

        T* request = tasks_queue.front();
        tasks_queue.pop();

        lck.unlock();
        
        if (request) {
            request->process();
            delete request;
        }
        
    }
    
}