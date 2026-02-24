/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

// Config structure for BlockerConfig
// This file shows the config keys and their default values

console.log({
  "[GGResource]": {
    "blocker": {
      "db": {
        "host": {
          "database": "blocker"
        }
      },
      "db_mysql": {
        "host": {
          "database": "blocker"
        }
      },
      "events": {
        "aws_sqs": {
          "blocker_user_events": {
            "resource": {}
          }
        }
      }
    }
  },
  "[GGSecret]": {
    "blocker": {
      "db": {
        "user": {
          "username": "postgres",
          "password": "postgres"
        }
      },
      "db_mysql": {
        "user": {
          "username": "root",
          "password": "root"
        }
      },
      "events": {
        "aws_sqs": {
          "blocker_user_events": {
            "credentials": {}
          }
        }
      }
    }
  },
  "[GGSetting]": {
    "blocker": {
      "events": {
        "aws_sqs": {
          "blocker_user_events": {
            "settings": {
              "batchSize": 20,
              "visibilityTimeout": 30,
              "waitTimeSeconds": 20,
              "concurrency": 1,
              "messageAgeWarningMs": 30000,
              "processingSlowThresholdMs": 5000,
              "highRedeliveryThreshold": 3
            }
          }
        }
      }
    }
  }
});
