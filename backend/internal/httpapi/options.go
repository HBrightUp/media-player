package httpapi

import "github.com/redis/go-redis/v9"

type Option func(*Server)

func WithRedis(client *redis.Client, keyPrefix string) Option {
	return func(s *Server) {
		if client == nil {
			return
		}
		s.redisRuntime = newRedisRuntimeStore(client, keyPrefix)
	}
}
