钉钉支持 Stream 模式接入事件推送、机器人收消息以及卡片回调，该 SDK 实现了 Stream 模式。相比 Webhook 模式，Stream 模式可以更简单的接入各类事件和回调。

## 开发教程

在 [教程文档](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/overview) 中，你可以找到钉钉 Stream 模式的教程文档和示例代码。

### 参考资料

* [Stream 模式说明](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview)
* [教程文档](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/overview)
* [常见问题](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/faq)
* [Stream 模式共创群](https://opensource.dingtalk.com/developerpedia/docs/explore/support/?via=moon-group)

### 调试方法

1、创建企业内部应用

进入钉钉开发者后台，创建企业内部应用，获取ClientID（即 AppKey）和ClientSecret（ 即AppSecret）。

2、开通Stream 模式的机器人

进入开发者后台新建的应用，点击应用能力 - 添加应用能力 - 机器人，完善机器人信息，选择stream模式并发布。

3、使用demo项目测试，启动服务：

a、获取demo项目

 git clone git@github.com:open-dingtalk/dingtalk-stream-sdk-nodejs.git
b、在example/config.json里配置应用信息。

c、启动测试case

cd dingtalk-stream-sdk-nodejs
yarn
npm run build
npm start


注意：ts-node-esm启动ts文件调试时，ts文件内import引用的文件后缀必须是js，ts会报找不到模块异常。
